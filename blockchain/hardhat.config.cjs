const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require("hardhat/builtin-tasks/task-names");
const fs = require("fs");
const path = require("path");

require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-network-helpers");
require("@nomicfoundation/hardhat-verify");
require("@openzeppelin/hardhat-upgrades");

const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "";
const DEPLOYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || "";
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || "";

function validatePrivateKey(key) {
  if (!key || key.length === 0) return false;
  return /^0x[a-fA-F0-9]{64}$/.test(key);
}

function sanitizeRpcUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

function getNetworkConfig(name, url, chainId, privateKey) {
  return {
    url: sanitizeRpcUrl(url) || `https://${name}.polygon.technology/`,
    accounts: validatePrivateKey(privateKey) ? [privateKey] : [],
    chainId,
  };
}

function collectSolidityFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSolidityFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".sol")) {
      files.push(entryPath);
    }
  }

  return files;
}

subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, { config }) => {
  const sourcePaths = collectSolidityFiles(config.paths.sources);

  // A handful of repository Solidity sources are committed with a UTF-8 BOM.
  // Solidity rejects that marker at byte zero, so normalize it before Hardhat
  // builds its dependency graph.
  for (const sourcePath of sourcePaths) {
    const content = fs.readFileSync(sourcePath, "utf8");
    if (content.charCodeAt(0) === 0xfeff) {
      fs.writeFileSync(sourcePath, content.slice(1), "utf8");
    }
  }

  return sourcePaths;
});

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
      {
        version: "0.8.21",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
      {
        version: "0.8.22",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
      {
        version: "0.8.23",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
    ],
  },
  networks: {
    hardhat: {},
    amoy: {
      url: process.env.POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
      chainId: 80002,
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
};
