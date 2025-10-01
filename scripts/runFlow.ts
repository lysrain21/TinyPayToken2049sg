import { network } from "hardhat";
import { type Hash, encodeAbiParameters, padHex, parseAbiParameters, parseEther, sha256 } from "viem";

const CONTRACT_ADDRESS = "0xfEAE0653D8FfA8fbCd23A3410F10CEdeFD56db0a";

async function main() {
  const { viem } = await network.connect();
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const contract = await viem.getContractAt("TinyPay", CONTRACT_ADDRESS);

  const send = async (txPromise: Promise<Hash>) => {
    const hash = await txPromise;
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  console.log("Using account:", deployer.account.address);

  const depositValue = parseEther("0.08");
  const opt1 = padHex("0x01", { size: 32 });
  const tail1 = sha256(opt1);
  const currentBalance = await contract.read.getBalance([deployer.account.address]);
  const currentTail = await contract.read.getUserTail([deployer.account.address]);

  if (currentBalance < depositValue) {
    const topUp = depositValue - currentBalance;
    console.log("Depositing", topUp, "wei with tail", tail1);
    await send(
      deployer.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "deposit",
        args: [tail1],
        value: topUp,
      }),
    );
  } else {
    console.log("Skipping deposit, existing balance:", currentBalance.toString());
  }

  if (currentTail !== tail1) {
    console.log("Refreshing tail to expected hash", tail1);
    await send(
      deployer.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "refreshTail",
        args: [tail1],
      }),
    );
  }

  const balanceAfterDeposit = await contract.read.getBalance([deployer.account.address]);
  console.log("Balance available for payments:", balanceAfterDeposit.toString());

  const amount = parseEther("0.03");
  const recipient = "0x000000000000000000000000000000000000dEaD";
  const commitHash = sha256(
    encodeAbiParameters(
      parseAbiParameters("address payer, address recipient, uint256 amount, bytes32 opt"),
      [deployer.account.address, recipient, amount, opt1],
    ),
  );

  console.log("Submitting merchant precommit", commitHash);
  await send(
    deployer.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "merchantPrecommit",
      args: [commitHash],
    }),
  );

  console.log("Completing payment via merchant, amount", amount.toString());
  await send(
    deployer.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "completePayment",
      args: [opt1, deployer.account.address, recipient, amount, commitHash],
    }),
  );

  const balanceAfterPayment = await contract.read.getBalance([deployer.account.address]);
  console.log("Balance after payment:", balanceAfterPayment.toString());

  const tailAfterPayment = await contract.read.getUserTail([deployer.account.address]);
  console.log("Tail after payment:", tailAfterPayment);

  const stats = await contract.read.getSystemStats();
  console.log("System stats (deposits, withdrawals, feeRate):", stats);

  const opt2 = padHex("0x02", { size: 32 });
  const tail2 = sha256(opt2);
  console.log("Refreshing tail to", tail2);
  await send(
    deployer.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "refreshTail",
      args: [tail2],
    }),
  );

  const paymasterAmount = parseEther("0.01");
  console.log("Completing payment via paymaster bypass, amount", paymasterAmount.toString());
  await send(
    deployer.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "completePayment",
      args: [opt2, deployer.account.address, recipient, paymasterAmount, "0x" + "00".repeat(32)],
    }),
  );

  const balanceAfterPaymaster = await contract.read.getBalance([deployer.account.address]);
  console.log("Balance after paymaster payment:", balanceAfterPaymaster.toString());

  const withdrawAmount = parseEther("0.015");
  console.log("Withdrawing", withdrawAmount.toString(), "back to payer wallet");
  await send(
    deployer.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "withdrawFunds",
      args: [withdrawAmount],
    }),
  );

  const finalBalance = await contract.read.getBalance([deployer.account.address]);
  console.log("Final on-contract balance:", finalBalance.toString());

  const recipientBalance = await publicClient.getBalance({ address: recipient });
  console.log("Recipient on-chain balance:", recipientBalance.toString());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
