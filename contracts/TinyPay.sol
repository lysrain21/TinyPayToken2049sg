// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

contract TinyPay {
    struct UserAccount {
        bytes tail;                // current tail (ASCII hex bytes)
        uint64 paymentLimit;       // per-payment limit (0 = unlimited)
        uint64 tailUpdateCount;    // total tail updates
        uint64 maxTailUpdates;     // max allowed updates (0 = unlimited)
        bool initialized;
    }

    struct PreCommit {
        address merchant;
        address token;
        uint64 expiryTime;
    }

    address public constant NATIVE_TOKEN = address(0);

    address public admin;
    address public paymaster;
    uint64 public feeRate;             // basis points (100 = 1%)
    bool public initialized;

    mapping(address => UserAccount) private accounts;
    mapping(address => mapping(address => uint256)) private userBalances; // user => token => balance
    mapping(address => uint256) private totalDepositsPerToken;
    mapping(address => uint256) private totalWithdrawalsPerToken;
    mapping(address => bool) private supportedTokens;
    mapping(bytes32 => PreCommit) private precommits;

    event AccountInitialized(address indexed user);
    event DepositMade(
        address indexed user,
        address indexed token,
        uint256 amount,
        bytes tail,
        uint256 newBalance,
        uint64 timestamp
    );
    event PreCommitMade(
        address indexed merchant,
        address indexed token,
        bytes32 commitHash,
        uint64 expiryTime
    );
    event PaymentCompleted(
        address indexed payer,
        address indexed recipient,
        address indexed token,
        uint256 amount,
        uint256 fee,
        bytes newTail,
        uint64 timestamp
    );
    event PaymentLimitUpdated(address indexed user, uint64 oldLimit, uint64 newLimit, uint64 timestamp);
    event TailUpdatesLimitSet(address indexed user, uint64 oldLimit, uint64 newLimit, uint64 timestamp);
    event TailRefreshed(address indexed user, bytes oldTail, bytes newTail, uint64 tailUpdateCount, uint64 timestamp);
    event FundsWithdrawn(address indexed user, address indexed token, uint256 amount, uint256 newBalance, uint64 timestamp);
    event CoinSupported(address indexed token, uint64 timestamp);

    modifier onlyAdmin() {
        require(msg.sender == admin, "NOT_ADMIN");
        _;
    }

    modifier onlyInitialized() {
        require(initialized, "NOT_INIT");
        _;
    }

    receive() external payable {
        revert("DIRECT_ETH_DISABLED");
    }

    // ---------------------------------------------------------------------
    // Initialisation & configuration
    // ---------------------------------------------------------------------

    function initSystem(address paymaster_, uint64 feeRate_) external {
        require(!initialized, "ALREADY_INIT");
        admin = msg.sender;
        paymaster = paymaster_;
        feeRate = feeRate_;
        initialized = true;

        supportedTokens[NATIVE_TOKEN] = true;
        emit CoinSupported(NATIVE_TOKEN, uint64(block.timestamp));
    }

    function addCoinSupport(address token) external onlyAdmin onlyInitialized {
        require(token != address(0), "INVALID_TOKEN" );
        require(!supportedTokens[token], "COIN_ALREADY_SUPPORTED");
        supportedTokens[token] = true;
        emit CoinSupported(token, uint64(block.timestamp));
    }

    function setPaymaster(address newPaymaster) external onlyAdmin {
        paymaster = newPaymaster;
    }

    function updateFeeRate(uint64 newFeeRate) external onlyAdmin {
        feeRate = newFeeRate;
    }

    // ---------------------------------------------------------------------
    // Core functionality
    // ---------------------------------------------------------------------

    function deposit(address token, uint256 amount, bytes calldata tail) external payable onlyInitialized {
        require(amount > 0, "INVALID_AMOUNT");
        require(supportedTokens[token], "COIN_NOT_SUPPORTED");

        if (token == NATIVE_TOKEN) {
            require(msg.value == amount, "INVALID_VALUE");
        } else {
            require(msg.value == 0, "VALUE_NOT_ALLOWED");
            _erc20TransferFrom(token, msg.sender, address(this), amount);
        }

        UserAccount storage account = accounts[msg.sender];
        if (!account.initialized) {
            account.initialized = true;
            emit AccountInitialized(msg.sender);
        }

        if (tail.length > 0 && !_bytesEqual(tail, account.tail)) {
            account.tailUpdateCount += 1;
        }
        account.tail = tail;

        userBalances[msg.sender][token] += amount;
        totalDepositsPerToken[token] += amount;

        emit DepositMade(
            msg.sender,
            token,
            amount,
            account.tail,
            userBalances[msg.sender][token],
            uint64(block.timestamp)
        );
    }

    function merchantPrecommit(
        address token,
        address payer,
        address recipient,
        uint256 amount,
        bytes calldata otp
    ) external onlyInitialized {
        require(supportedTokens[token], "COIN_NOT_SUPPORTED");

        bytes32 commitHash = sha256(
            abi.encode(payer, recipient, amount, otp, token)
        );

        require(precommits[commitHash].merchant == address(0), "COMMIT_EXISTS");

        uint64 expiryTime = uint64(block.timestamp + 15 minutes);
        precommits[commitHash] = PreCommit({
            merchant: msg.sender,
            token: token,
            expiryTime: expiryTime
        });

        emit PreCommitMade(msg.sender, token, commitHash, expiryTime);
    }

    function completePayment(
        address token,
        bytes calldata otp,
        address payer,
        address payable recipient,
        uint256 amount,
        bytes32 commitHash
    ) external onlyInitialized {
        require(amount > 0, "INVALID_AMOUNT");
        require(supportedTokens[token], "COIN_NOT_SUPPORTED");

        UserAccount storage account = accounts[payer];
        require(account.initialized, "ACCOUNT_NOT_INITIALIZED");

        if (msg.sender != paymaster) {
            _validatePrecommit(token, payer, recipient, amount, otp, commitHash);
        }

        bytes memory otpHashAscii = _sha256Hex(otp);
        require(_bytesEqual(otpHashAscii, account.tail), "INVALID_OTP");

        uint256 payerBalance = userBalances[payer][token];
        require(payerBalance >= amount, "INSUFFICIENT_BALANCE");

        if (account.paymentLimit > 0) {
            require(amount <= account.paymentLimit, "PAYMENT_LIMIT");
        }
        if (account.maxTailUpdates > 0) {
            require(account.tailUpdateCount < account.maxTailUpdates, "TAIL_UPDATES_LIMIT");
        }

        uint256 fee = (amount * feeRate) / 10_000;
        uint256 toRecipient = amount - fee;

        userBalances[payer][token] = payerBalance - amount;
        account.tail = otp;
        account.tailUpdateCount += 1;
        totalWithdrawalsPerToken[token] += amount;

        if (token == NATIVE_TOKEN) {
            _safeTransferETH(recipient, toRecipient);
        } else {
            _erc20Transfer(token, recipient, toRecipient);
        }

        emit PaymentCompleted(
            payer,
            recipient,
            token,
            amount,
            fee,
            otp,
            uint64(block.timestamp)
        );
    }

    function withdrawFunds(address token, uint256 amount) external onlyInitialized {
        require(amount > 0, "INVALID_AMOUNT");
        require(supportedTokens[token], "COIN_NOT_SUPPORTED");

        UserAccount storage account = accounts[msg.sender];
        require(account.initialized, "ACCOUNT_NOT_INITIALIZED");

        uint256 balanceBefore = userBalances[msg.sender][token];
        require(balanceBefore >= amount, "INSUFFICIENT_BALANCE");

        userBalances[msg.sender][token] = balanceBefore - amount;
        totalWithdrawalsPerToken[token] += amount;

        if (token == NATIVE_TOKEN) {
            _safeTransferETH(payable(msg.sender), amount);
        } else {
            _erc20Transfer(token, msg.sender, amount);
        }

        emit FundsWithdrawn(
            msg.sender,
            token,
            amount,
            userBalances[msg.sender][token],
            uint64(block.timestamp)
        );
    }

    function withdrawFee(address token, address payable to, uint256 amount) external onlyAdmin {
        require(amount > 0, "INVALID_AMOUNT");
        if (token == NATIVE_TOKEN) {
            _safeTransferETH(to, amount);
        } else {
            _erc20Transfer(token, to, amount);
        }
    }

    // ---------------------------------------------------------------------
    // User configuration
    // ---------------------------------------------------------------------

    function setPaymentLimit(uint64 limit) external onlyInitialized {
        UserAccount storage account = accounts[msg.sender];
        require(account.initialized, "ACCOUNT_NOT_INITIALIZED");

        uint64 oldLimit = account.paymentLimit;
        account.paymentLimit = limit;
        emit PaymentLimitUpdated(msg.sender, oldLimit, limit, uint64(block.timestamp));
    }

    function setTailUpdatesLimit(uint64 limit) external onlyInitialized {
        UserAccount storage account = accounts[msg.sender];
        require(account.initialized, "ACCOUNT_NOT_INITIALIZED");

        uint64 oldLimit = account.maxTailUpdates;
        account.maxTailUpdates = limit;
        emit TailUpdatesLimitSet(msg.sender, oldLimit, limit, uint64(block.timestamp));
    }

    function refreshTail(bytes calldata newTail) external onlyInitialized {
        UserAccount storage account = accounts[msg.sender];
        require(account.initialized, "ACCOUNT_NOT_INITIALIZED");
        if (account.maxTailUpdates > 0) {
            require(account.tailUpdateCount < account.maxTailUpdates, "TAIL_UPDATES_LIMIT");
        }

        bytes memory oldTail = account.tail;
        account.tail = newTail;
        account.tailUpdateCount += 1;

        emit TailRefreshed(
            msg.sender,
            oldTail,
            newTail,
            account.tailUpdateCount,
            uint64(block.timestamp)
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getBalance(address user, address token) external view returns (uint256) {
        return userBalances[user][token];
    }

    function getUserTail(address user) external view returns (bytes memory) {
        return accounts[user].tail;
    }

    function getUserLimits(address user) external view returns (uint64 paymentLimit, uint64 tailUpdateCount, uint64 maxTailUpdates) {
        UserAccount storage account = accounts[user];
        return (account.paymentLimit, account.tailUpdateCount, account.maxTailUpdates);
    }

    function isAccountInitialized(address user) external view returns (bool) {
        return accounts[user].initialized;
    }

    function isCoinSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }

    function getSystemStats(address token) external view returns (uint256 totalDeposits, uint256 totalWithdrawals, uint64 currentFeeRate) {
        return (
            totalDepositsPerToken[token],
            totalWithdrawalsPerToken[token],
            feeRate
        );
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _erc20TransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }

    function _erc20Transfer(address token, address to, uint256 amount) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    function _safeTransferETH(address payable to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "TRANSFER_FAIL");
    }

    function _bytesEqual(bytes memory a, bytes memory b) private pure returns (bool) {
        return keccak256(a) == keccak256(b);
    }

    function _sha256Hex(bytes memory input) private pure returns (bytes memory) {
        bytes32 hashed = sha256(input);
        return _bytes32ToHexBytes(hashed);
    }

    function _bytes32ToHexBytes(bytes32 data) private pure returns (bytes memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(data[i]);
            str[2 * i] = alphabet[b >> 4];
            str[2 * i + 1] = alphabet[b & 0x0f];
        }
        return str;
    }

    function _validatePrecommit(
        address token,
        address payer,
        address recipient,
        uint256 amount,
        bytes calldata otp,
        bytes32 commitHash
    ) private {
        bytes32 computedHash = sha256(abi.encode(payer, recipient, amount, otp, token));
        require(computedHash == commitHash, "INVALID_PRECOMMIT_HASH");

        PreCommit memory pc = precommits[commitHash];
        require(pc.merchant != address(0), "PRECOMMIT_NOT_FOUND");
        require(pc.token == token, "TOKEN_MISMATCH");
        require(block.timestamp <= pc.expiryTime, "PRECOMMIT_EXPIRED");
        delete precommits[commitHash];
    }
}
