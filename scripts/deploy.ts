import { network } from "hardhat";

async function main() {
  const { viem } = await network.connect();
  const [deployer] = await viem.getWalletClients();

  console.log("Deploying with:", deployer.account.address);

  const contract = await viem.deployContract("TinyPay");
  const address = contract.address;
  console.log("TinyPay deployed at:", address);

  const feeRate = BigInt(process.env.FEE_BPS || "100");

  const txHash = await contract.write.initSystem([deployer.account.address, feeRate]);
  const publicClient = await viem.getPublicClient();
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  console.log("initSystem done. paymaster=", await contract.read.paymaster());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
