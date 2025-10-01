import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { encodeAbiParameters, parseAbiParameters, sha256 } from "viem";

const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000" as const;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as const;

const asciiToHexBytes = (hexString: string) =>
  (`0x${Buffer.from(hexString, "ascii").toString("hex")}`) as const;

const bytesToAscii = (bytes: string) => Buffer.from(bytes.slice(2), "hex").toString("ascii");

const prepareOptAndTail = (optHexString: string) => {
  const optBytes = asciiToHexBytes(optHexString);
  const tailHexString = sha256(optBytes).slice(2);
  const tailBytes = asciiToHexBytes(tailHexString);
  return { optHexString, optBytes, tailHexString, tailBytes };
};

describe("TinyPay", async () => {
  const { viem, networkHelpers } = await network.connect();
  const { loadFixture } = networkHelpers;
  const [deployer, user, merchant, recipient, paymaster] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  async function deployTinyPayFixture() {
    const contract = await viem.deployContract("TinyPay");
    await contract.write.initSystem([paymaster.account.address, 100n]);
    return { contract };
  }

  async function depositWithTailFixture() {
    const { contract } = await deployTinyPayFixture();
    const depositValue = 1n * 10n ** 18n;
    const { optHexString, optBytes, tailHexString, tailBytes } = prepareOptAndTail(
      "84eb882e56142984dea2fee9772d60c05d3885941fd2522761451446f46ae437",
    );

    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "deposit",
      args: [NATIVE_TOKEN, depositValue, tailBytes],
      value: depositValue,
    });

    return { contract, depositValue, optHexString, optBytes, tailHexString, tailBytes };
  }

  it("allows users to deposit and updates balance/tail", async () => {
    const { contract } = await loadFixture(deployTinyPayFixture);
    const depositValue = 2n * 10n ** 17n; // 0.2 ETH
    const { tailHexString, tailBytes } = prepareOptAndTail(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "deposit",
      args: [NATIVE_TOKEN, depositValue, tailBytes],
      value: depositValue,
    });

    const balance = await contract.read.getBalance([user.account.address, NATIVE_TOKEN]);
    assert.equal(balance, depositValue);

    const storedTailBytes = await contract.read.getUserTail([user.account.address]);
    assert.equal(bytesToAscii(storedTailBytes), tailHexString);

    const stats = await contract.read.getSystemStats([NATIVE_TOKEN]);
    assert.equal(stats[0], depositValue);
    assert.equal(stats[1], 0n);
    assert.equal(stats[2], 100n);
  });

  it("supports merchant precommit and payment completion", async () => {
    const { contract, depositValue, optHexString, optBytes, tailHexString } = await loadFixture(depositWithTailFixture);

    const amount = depositValue / 2n;
    const payer = user.account.address;
    const receiver = recipient.account.address;

    const fromBlock = await publicClient.getBlockNumber();

    const commitHash = sha256(
      encodeAbiParameters(
        parseAbiParameters("address payer, address recipient, uint256 amount, bytes opt, address token"),
        [payer, receiver, amount, optBytes, NATIVE_TOKEN],
      ),
    );

    await merchant.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "merchantPrecommit",
      args: [NATIVE_TOKEN, payer, receiver, amount, optBytes],
    });

    const events = await publicClient.getContractEvents({
      address: contract.address,
      abi: contract.abi,
      eventName: "PreCommitMade",
      fromBlock,
      toBlock: "latest",
    });
    assert.equal(events.length, 1);

    const recipientBalanceBefore = await publicClient.getBalance({ address: receiver });

    await merchant.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "completePayment",
      args: [NATIVE_TOKEN, optBytes, payer, receiver, amount, commitHash],
    });

    const recipientBalanceAfter = await publicClient.getBalance({ address: receiver });
    const fee = (amount * 100n) / 10000n;

    const balanceAfter = await contract.read.getBalance([payer, NATIVE_TOKEN]);
    assert.equal(balanceAfter, depositValue - amount);

    const tailAfterBytes = await contract.read.getUserTail([payer]);
    assert.equal(bytesToAscii(tailAfterBytes), optHexString);

    const stats = await contract.read.getSystemStats([NATIVE_TOKEN]);
    assert.equal(stats[1], amount);

    assert.equal(recipientBalanceAfter - recipientBalanceBefore, amount - fee);
  });

  it("lets the paymaster bypass commit validation", async () => {
    const { contract } = await loadFixture(depositWithTailFixture);
    const amount = 1n * 10n ** 17n;
    const { optHexString, optBytes, tailBytes } = prepareOptAndTail(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );

    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "refreshTail",
      args: [tailBytes],
    });

    await paymaster.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "completePayment",
      args: [NATIVE_TOKEN, optBytes, user.account.address, merchant.account.address, amount, ZERO_BYTES32],
    });

    const updatedTailBytes = await contract.read.getUserTail([user.account.address]);
    assert.equal(bytesToAscii(updatedTailBytes), optHexString);
  });

  it("enforces payment limits", async () => {
    const { contract } = await loadFixture(depositWithTailFixture);

    const limit = 5_000_000_000_000_000n; // 0.005 ETH
    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "setPaymentLimit",
      args: [limit],
    });

    const { optBytes, tailBytes } = prepareOptAndTail(
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    );

    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "refreshTail",
      args: [tailBytes],
    });

    const amount = limit + 1n;
    const commitHash = sha256(
      encodeAbiParameters(
        parseAbiParameters("address payer, address recipient, uint256 amount, bytes opt, address token"),
        [user.account.address, merchant.account.address, amount, optBytes, NATIVE_TOKEN],
      ),
    );

    await merchant.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "merchantPrecommit",
      args: [NATIVE_TOKEN, user.account.address, merchant.account.address, amount, optBytes],
    });

    await assert.rejects(
      merchant.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "completePayment",
        args: [NATIVE_TOKEN, optBytes, user.account.address, merchant.account.address, amount, commitHash],
      }),
      { message: /PAYMENT_LIMIT/ },
    );
  });

  it("initializes system state correctly", async () => {
    const contract = await viem.deployContract("TinyPay");
    const initTx = await contract.write.initSystem([paymaster.account.address, 250n]);

    assert.ok(initTx);
    assert.equal((await contract.read.admin()).toLowerCase(), deployer.account.address.toLowerCase());
    assert.equal((await contract.read.paymaster()).toLowerCase(), paymaster.account.address.toLowerCase());
    assert.equal(await contract.read.feeRate(), 250n);
    assert.equal(await contract.read.initialized(), true);

    const isNativeSupported = await contract.read.isCoinSupported([NATIVE_TOKEN]);
    assert.equal(isNativeSupported, true);
  });

  it("allows withdrawals and updates stats", async () => {
    const { contract, depositValue } = await loadFixture(depositWithTailFixture);
    const withdrawValue = depositValue / 2n;

    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "withdrawFunds",
      args: [NATIVE_TOKEN, withdrawValue],
    });

    const userBalance = await contract.read.getBalance([user.account.address, NATIVE_TOKEN]);
    assert.equal(userBalance, depositValue - withdrawValue);

    const stats = await contract.read.getSystemStats([NATIVE_TOKEN]);
    assert.equal(stats[1], withdrawValue);
  });

  it("tracks tail update limits", async () => {
    const { contract } = await loadFixture(depositWithTailFixture);

    await user.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "setTailUpdatesLimit",
      args: [5n],
    });

    const tails = ["tail_one", "tail_two", "tail_three"];

    for (const tail of tails) {
      await user.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "refreshTail",
        args: [asciiToHexBytes(tail)],
      });
    }

    const updatedTailBytes = await contract.read.getUserTail([user.account.address]);
    assert.equal(bytesToAscii(updatedTailBytes), tails[tails.length - 1]);

    const limits = await contract.read.getUserLimits([user.account.address]);
    assert.equal(limits[2], 5n);
    assert.ok(limits[1] >= 4n);
  });

  it("rejects unsupported token deposits", async () => {
    const { contract } = await loadFixture(deployTinyPayFixture);
    const fakeToken = merchant.account.address;

    await assert.rejects(
      user.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "deposit",
        args: [fakeToken, 1n, "0x"],
        value: 0n,
      }),
      { message: /COIN_NOT_SUPPORTED/ },
    );
  });

  it("prevents withdrawing beyond balance", async () => {
    const { contract } = await loadFixture(depositWithTailFixture);
    const excessive = (await contract.read.getBalance([user.account.address, NATIVE_TOKEN])) + 1n;

    await assert.rejects(
      user.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "withdrawFunds",
        args: [NATIVE_TOKEN, excessive],
      }),
      { message: /INSUFFICIENT_BALANCE/ },
    );
  });

  it("handles multiple deposits and withdrawals", async () => {
    const { contract } = await loadFixture(deployTinyPayFixture);
    const deposits = [1n, 2n, 3n].map((n) => n * 10n ** 17n);

    for (const amount of deposits) {
      await user.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "deposit",
        args: [NATIVE_TOKEN, amount, asciiToHexBytes(`tail_${amount.toString()}`)],
        value: amount,
      });
    }

    const totalDeposit = deposits.reduce((acc, cur) => acc + cur, 0n);
    const balanceAfterDeposits = await contract.read.getBalance([user.account.address, NATIVE_TOKEN]);
    assert.equal(balanceAfterDeposits, totalDeposit);

    const withdrawals = [5n, 10n].map((n) => n * 10n ** 16n);
    for (const amount of withdrawals) {
      await user.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "withdrawFunds",
        args: [NATIVE_TOKEN, amount],
      });
    }

    const totalWithdrawal = withdrawals.reduce((acc, cur) => acc + cur, 0n);
    const finalBalance = await contract.read.getBalance([user.account.address, NATIVE_TOKEN]);
    assert.equal(finalBalance, totalDeposit - totalWithdrawal);

    const stats = await contract.read.getSystemStats([NATIVE_TOKEN]);
    assert.equal(stats[0], totalDeposit);
    assert.equal(stats[1], totalWithdrawal);
  });
});
