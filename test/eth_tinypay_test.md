# TinyPay 智能合约测试报告

## 测试环境
- 区块链开发框架：Hardhat 3.0.6
- 测试执行命令：`npm test`
- 测试网络：Hardhat 内置本地链（自动为每个用例回滚到 fixture 状态）
- 主要依赖：`@nomicfoundation/hardhat-toolbox-viem` 提供 `viem` 客户端，`node:test` 断言框架

## 功能验证概览
| 测试用例 | 关联接口 | 验证目标 | 结果 |
| --- | --- | --- | --- |
| allows users to deposit and updates balance/tail | `deposit`, `getBalance`, `getUserTail`, `getSystemStats` | 存入原生资产时余额、尾部哈希与系统统计应正确更新 | 通过 |
| supports merchant precommit and payment completion | `merchantPrecommit`, `completePayment` | 商户预提交 + OTP 校验完成支付链路，收款人获得扣除手续费后的金额 | 通过 |
| lets the paymaster bypass commit validation | `completePayment` | 特权 `paymaster` 可跳过预提交验证完成支付 | 通过 |
| enforces payment limits | `setPaymentLimit`, `completePayment` | 用户设置单笔限额后，大额支付应被拒绝 | 通过（触发 `PAYMENT_LIMIT`） |
| initializes system state correctly | `initSystem`, `isCoinSupported`, 状态视图 | 初始化时管理员/结算人/费率、原生币支持状态正确 | 通过 |
| allows withdrawals and updates stats | `withdrawFunds`, `getSystemStats` | 提现应减少余额、增加系统提款统计 | 通过 |
| tracks tail update limits | `setTailUpdatesLimit`, `refreshTail`, `getUserTail`, `getUserLimits` | 限制尾部更新次数并确认最新尾部值 | 通过 |
| rejects unsupported token deposits | `deposit`, `isCoinSupported` | 未加白资产存款应失败 | 通过（触发 `COIN_NOT_SUPPORTED`） |
| prevents withdrawing beyond balance | `withdrawFunds` | 超额提现应失败 | 通过（触发 `INSUFFICIENT_BALANCE`） |
| handles multiple deposits and withdrawals | `deposit`, `withdrawFunds`, `getBalance`, `getSystemStats` | 多次存取款后的余额与统计应与累计值一致 | 通过 |

## 详细测试说明

### 1. 用户存款与尾部哈希更新
- **接口**：`deposit` (`eth_con/contracts/TinyPay.sol:116`), `getBalance` (`eth_con/contracts/TinyPay.sol:315`), `getUserTail` (`eth_con/contracts/TinyPay.sol:319`)
- **步骤**：用户向合约存入 0.2 ETH，并提交预先计算的尾部哈希（一次性密码链末端）。
- **期望**：余额等于存款金额，尾部哈希保存为 ASCII 十六进制字符串，系统统计的总存款同步增加。
- **结果**：`eth_con/test/TinyPay.ts:52` 用例通过断言确认上述行为。

### 2. 商户预提交与支付闭环
- **接口**：`merchantPrecommit` (`eth_con/contracts/TinyPay.sol:151`), `completePayment` (`eth_con/contracts/TinyPay.sol:176`)
- **步骤**：商户根据付款人、收款人、金额、随机 OTP 生成提交哈希；付款方预存余额和尾部哈希后，商户调用 `completePayment`。
- **期望**：
  - 预提交事件 `PreCommitMade` 发出；
  - 完成支付时验证 OTP 哈希与账户尾部匹配；
  - 付款人余额减少、收款人实际到账减去费率，尾部更新为当前 OTP。
- **结果**：`eth_con/test/TinyPay.ts:79` 验证事件数量、账户余额差额、尾部更新及手续费计算均符合预期。

### 3. Paymaster 绕过预提交验证
- **接口**：`completePayment` (`eth_con/contracts/TinyPay.sol:176`)
- **步骤**：指定 `paymaster` 账号直接调用 `completePayment` 并传入空提交哈希。
- **期望**：跳过 `_validatePrecommit` 校验，仍可完成支付并更新尾部。
- **结果**：`eth_con/test/TinyPay.ts:112` 用例通过断言确认尾部已更新为新 OTP。

### 4. 单笔支付限额管控
- **接口**：`setPaymentLimit` (`eth_con/contracts/TinyPay.sol:273`), `completePayment`
- **步骤**：用户设置限额为 0.005 ETH，商户提交超过限额的支付。
- **期望**：支付调用 revert，报错信息包含 `PAYMENT_LIMIT`。
- **结果**：`eth_con/test/TinyPay.ts:141` 用例捕获到预期异常。

### 5. 系统初始化校验
- **接口**：`initSystem` (`eth_con/contracts/TinyPay.sol:86`), `isCoinSupported`
- **步骤**：部署合约后调用 `initSystem`，传入自定义费率和 `paymaster` 地址。
- **期望**：管理员、paymaster、费率、初始化标志正确写入，原生币默认被支持。
- **结果**：`eth_con/test/TinyPay.ts:187` 用例对读取到的地址和状态逐一校验。

### 6. 提款流程与统计
- **接口**：`withdrawFunds` (`eth_con/contracts/TinyPay.sol:232`), `getSystemStats`
- **步骤**：存入 1 ETH 后提取一半。
- **期望**：用户余额减半，系统 `totalWithdrawalsPerToken` 增加同等数值。
- **结果**：`eth_con/test/TinyPay.ts:222` 用例断言余额与统计值均正确。

### 7. 尾部更新次数限制
- **接口**：`setTailUpdatesLimit` (`eth_con/contracts/TinyPay.sol:282`), `refreshTail` (`eth_con/contracts/TinyPay.sol:291`), `getUserLimits`, `getUserTail`
- **步骤**：设置最大更新次数为 5，连续刷新 3 次尾部。
- **期望**：最新尾部为最后一次提交的字符串，`tailUpdateCount` 至少为 4（含初始存款），`maxTailUpdates` 返回 5。
- **结果**：`eth_con/test/TinyPay.ts:240` 用例确认各项指标满足预期。

### 8. 非支持资产拦截
- **接口**：`deposit`
- **步骤**：尝试向合约提交未通过 `addCoinSupport` 的地址作为代币。
- **期望**：交易失败，错误信息匹配 `COIN_NOT_SUPPORTED`。
- **结果**：`eth_con/test/TinyPay.ts:269` 用例捕获到预期失败。

### 9. 超额提现防护
- **接口**：`withdrawFunds`
- **步骤**：读取余额后尝试提现余额 + 1 wei。
- **期望**：调用 revert，错误信息包含 `INSUFFICIENT_BALANCE`。
- **结果**：`eth_con/test/TinyPay.ts:285` 用例验证失败信息正确。

### 10. 多次存取款的累计统计
- **接口**：`deposit`, `withdrawFunds`, `getBalance`, `getSystemStats`
- **步骤**：连续三次不同金额存款，再进行两次提现。
- **期望**：
  - 用户余额等于所有存款之和减去提款之和；
  - 系统统计的总存款、总提款分别等于累计金额。
- **结果**：`eth_con/test/TinyPay.ts:300` 用例断言累计数值精确匹配。

## 结论
Hardhat 测试覆盖了 TinyPay 以太坊合约的核心业务流程：初始化、存取款、尾部（一次性密码链）维护、支付闭环、权限与限额控制，以及错误场景校验。所有用例均在本地链环境下执行并通过，表明合约行为与 Aptos 版本测试场景保持一致，满足当前设计目标。

## 以太坊合约与 Aptos Move 合约接口对照
| 功能 | 以太坊 TinyPay 接口 | Aptos Move TinyPay 接口 |
| --- | --- | --- |
| 系统初始化 | `initSystem(address paymaster_, uint64 feeRate_)` (`eth_con/contracts/TinyPay.sol:86`) | `init_system(&signer)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:295`) |
| 支持资产管理 | `addCoinSupport(address token)` (`eth_con/contracts/TinyPay.sol:97`) | `add_asset_support(&signer, Object<Metadata>)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:309`) |
| 存款与尾部设置 | `deposit(address token, uint256 amount, bytes tail)` (`eth_con/contracts/TinyPay.sol:116`) | `deposit(&signer, Object<Metadata>, u64, vector<u8>)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:329`) |
| 商户预提交 | `merchantPrecommit(address token, address payer, address recipient, uint256 amount, bytes opt)` (`eth_con/contracts/TinyPay.sol:151`) | `merchant_precommit(&signer, address, address, u64, Object<Metadata>, vector<u8>)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:158`) |
| 完成支付 | `completePayment(address token, bytes opt, address payer, address payable recipient, uint256 amount, bytes32 commitHash)` (`eth_con/contracts/TinyPay.sol:176`) | `complete_payment(&signer, vector<u8>, address, address, u64, Object<Metadata>, vector<u8>)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:365`) |
| 提取余额 | `withdrawFunds(address token, uint256 amount)` (`eth_con/contracts/TinyPay.sol:232`) | `withdraw_funds(&signer, Object<Metadata>, u64)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:432`) |
| 收取手续费 | `withdrawFee(address token, address payable to, uint256 amount)` (`eth_con/contracts/TinyPay.sol:260`) | 暂无直接对应接口（Move 合约由管理员掌握 vault signer，可另行实现） |
| 设置单笔限额 | `setPaymentLimit(uint64 limit)` (`eth_con/contracts/TinyPay.sol:273`) | `set_payment_limit(&signer, u64)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:470`) |
| 限制尾部更新次数 | `setTailUpdatesLimit(uint64 limit)` (`eth_con/contracts/TinyPay.sol:282`) | `set_tail_updates_limit(&signer, u64)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:490`) |
| 手动刷新尾部 | `refreshTail(bytes newTail)` (`eth_con/contracts/TinyPay.sol:291`) | `refresh_tail(&signer, vector<u8>)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:508`) |
| 查询余额 | `getBalance(address user, address token)` (`eth_con/contracts/TinyPay.sol:315`) | `get_balance(address, Object<Metadata>)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:537`) |
| 查询是否加白 | `isCoinSupported(address token)` (`eth_con/contracts/TinyPay.sol:332`) | `is_asset_supported(Object<Metadata>)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:551`) |
| 查询用户限制 | `getUserLimits(address user)` (`eth_con/contracts/TinyPay.sol:323`) | `get_user_limits(address)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:559`) |
| 查询尾部哈希 | `getUserTail(address user)` (`eth_con/contracts/TinyPay.sol:319`) | `get_user_tail(address)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:569`) |
| 查询系统统计 | `getSystemStats(address token)` (`eth_con/contracts/TinyPay.sol:336`) | `get_system_stats(Object<Metadata>)` (`eth_con/TinyPayContract-Aptos/sources/tinypay.move:579`) |
