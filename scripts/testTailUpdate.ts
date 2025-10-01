import { network } from "hardhat";
import { sha256, encodeAbiParameters, parseAbiParameters } from "viem";

const CONTRACT_ADDRESS = "0xc63c0fc875b189ad26f1855a471e8e22a23c7fc9";
const TOKEN = "0x0000000000000000000000000000000000000000"; // native ETH
const OPT_STR = "84eb882e56142984dea2fee9772d60c05d3885941fd2522761451446f46ae437";
const TAIL_STR = "adb6beedc72be327ccbc58cf8c866ea608603c27568ec0752dc7d1e7608507a6";
const AMOUNT = 5n * 10n ** 15n; // 0.005 ETH
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

const asciiToHex = (s: string) => ("0x" + Buffer.from(s, "ascii").toString("hex")) as const;

async function main() {
  const { viem } = await network.connect();
  const [payer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const contract = await viem.getContractAt("TinyPay", CONTRACT_ADDRESS);

  console.log("Using payer:", payer.account.address);

  const tailHex = asciiToHex(TAIL_STR);
  const optHex = asciiToHex(OPT_STR);

  const beforeTail = await contract.read.getUserTail([payer.account.address]);
  console.log("Tail before deposit:", Buffer.from(beforeTail).toString("ascii"));

  const balanceBefore = await contract.read.getBalance([payer.account.address, TOKEN]);
  console.log("Balance before deposit:", balanceBefore.toString());

  if (balanceBefore < AMOUNT) {
    const topUp = AMOUNT - balanceBefore + 1_000_000_000_000_000n; // add 0.001 extra for safety
    console.log("Depositing", topUp.toString(), "wei with tail", TAIL_STR);
    const txHash = await payer.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "deposit",
      args: [TOKEN, topUp, tailHex],
      value: topUp,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  } else {
    console.log("Balance sufficient, refreshing tail only");
    const txHash = await payer.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "refreshTail",
      args: [tailHex],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  const tailAfterSetup = await contract.read.getUserTail([payer.account.address]);
  console.log("Tail after setup:", Buffer.from(tailAfterSetup).toString("ascii"));

  const commitHash = sha256(
    encodeAbiParameters(
      parseAbiParameters("address payer, address recipient, uint256 amount, bytes opt, address token"),
      [payer.account.address, RECIPIENT, AMOUNT, optHex, TOKEN]
    )
  );

  console.log("Computed commitHash:", commitHash);

  const precommitTx = await payer.writeContract({
    address: contract.address,
    abi: contract.abi,
    functionName: "merchantPrecommit",
    args: [TOKEN, payer.account.address, RECIPIENT, AMOUNT, optHex],
  });
  await publicClient.waitForTransactionReceipt({ hash: precommitTx });
  console.log("Precommit complete");

  const completeTx = await payer.writeContract({
    address: contract.address,
    abi: contract.abi,
    functionName: "completePayment",
    args: [TOKEN, optHex, payer.account.address, RECIPIENT, AMOUNT, commitHash],
  });
  await publicClient.waitForTransactionReceipt({ hash: completeTx });
  console.log("Payment completed");

  const tailAfterPayment = await contract.read.getUserTail([payer.account.address]);
  console.log("Tail after payment:", Buffer.from(tailAfterPayment).toString("ascii"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
