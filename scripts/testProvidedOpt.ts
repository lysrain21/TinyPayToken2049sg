import { network } from "hardhat";
import {
  encodeAbiParameters,
  padHex,
  parseAbiParameters,
  parseEther,
  sha256,
  type Hash,
} from "viem";

const CONTRACT_ADDRESS = "0xfEAE0653D8FfA8fbCd23A3410F10CEdeFD56db0a";

const OPT_HEX = "0x84eb882e56142984dea2fee9772d60c05d3885941fd2522761451446f46ae437" as const;
const TAIL_HEX = "0xadb6beedc72be327ccbc58cf8c866ea608603c27568ec0752dc7d1e7608507a6" as const;

async function waitHash(publicClient: any, promise: Promise<Hash>) {
  const hash = await promise;
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function main() {
  const { viem } = await network.connect();
  const [payer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const contract = await viem.getContractAt("TinyPay", CONTRACT_ADDRESS);

  console.log("使用账户:", payer.account.address);

  const balanceBefore = await contract.read.getBalance([payer.account.address]);
  const tailBefore = await contract.read.getUserTail([payer.account.address]);
  console.log("当前链上余额:", balanceBefore.toString());
  console.log("当前 tail:", tailBefore);

  if (balanceBefore < parseEther("0.005")) {
    const topUp = parseEther("0.005") - balanceBefore;
    console.log("余额不足，补充存款:", topUp.toString());
    await waitHash(
      publicClient,
      payer.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "deposit",
        args: [TAIL_HEX],
        value: topUp,
      }),
    );
  } else {
    console.log("余额充足，无需额外存款");
  }

  console.log("刷新 tail ->", TAIL_HEX);
  await waitHash(
    publicClient,
    payer.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "refreshTail",
      args: [TAIL_HEX],
    }),
  );

  const tailAfterRefresh = await contract.read.getUserTail([payer.account.address]);
  console.log("刷新后 tail:", tailAfterRefresh);

  const amount = parseEther("0.005");
  const recipient = "0x000000000000000000000000000000000000dEaD";
  const commitHash = sha256(
    encodeAbiParameters(
      parseAbiParameters("address payer, address recipient, uint256 amount, bytes32 opt"),
      [payer.account.address, recipient, amount, OPT_HEX],
    ),
  );

  console.log("提交预承诺 hash:", commitHash);
  await waitHash(
    publicClient,
    payer.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "merchantPrecommit",
      args: [commitHash],
    }),
  );

  console.log("调用 completePayment", {
    opt: OPT_HEX,
    payer: payer.account.address,
    recipient,
    amount: amount.toString(),
    commitHash,
  });

  try {
    await waitHash(
      publicClient,
      payer.writeContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "completePayment",
        args: [OPT_HEX, payer.account.address, recipient, amount, commitHash],
      }),
    );
    console.log("completePayment 成功");
  } catch (err) {
    console.error("completePayment 失败:", err);
  }

  const tailFinal = await contract.read.getUserTail([payer.account.address]);
  console.log("交易后 tail:", tailFinal);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
