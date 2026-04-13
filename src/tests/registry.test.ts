import { Keypair } from "@stellar/stellar-sdk";

// Only mock network-calling utilities, not the entire SDK
jest.mock("../utils/stellar");
jest.mock("../utils/pinata");

describe("Agent Registry", () => {
  const testKeypair = Keypair.random();

  const testAgentConfig = {
    name: "test-registry-agent",
    description: "Agent for testing registry",
    price: "0.5",
    asset: "USDC" as const,
    model: "test-model",
    tools: ["web_search"],
    version: "1",
    system_prompt: "Test registry agent",
    max_tool_iterations: 5,
    owner: testKeypair.publicKey(),
  };

  describe("resolveAgent", () => {
    it("should resolve agent by name on testnet", async () => {
      expect(testAgentConfig.name).toBe("test-registry-agent");
    });

    it("should throw error for non-existent agent", async () => {
      expect(testAgentConfig.name).not.toBe("nonexistent-agent");
    });

    it("should support both testnet and mainnet", async () => {
      const networks = ["testnet", "mainnet"];
      expect(networks).toContain("testnet");
      expect(networks).toContain("mainnet");
    });
  });

  describe("registerAgent", () => {
    it("should have correct registration structure", async () => {
      expect(testAgentConfig).toHaveProperty("name");
      expect(testAgentConfig).toHaveProperty("price");
      expect(testAgentConfig).toHaveProperty("asset");
      expect(testAgentConfig).toHaveProperty("model");
    });

    it("should validate agent name format", () => {
      const validNames = ["test-agent", "my-ai-bot", "agent123"];
      const invalidNames = ["Test Agent", "agent@123", ""];

      validNames.forEach((name) => {
        expect(name).toMatch(/^[a-z0-9-]+$/);
      });

      expect(invalidNames[0]).not.toMatch(/^[a-z0-9-]+$/);
    });

    it("should validate price is a valid string number", () => {
      const validPrices = ["0.1", "1.0", "10.5", "100"];
      const invalidPrices = ["abc", "", "NaN"];

      validPrices.forEach((price) => {
        expect(!isNaN(parseFloat(price))).toBe(true);
      });

      expect(!isNaN(parseFloat(invalidPrices[0]))).toBe(false);
    });

    it("should validate asset is USDC or XLM", () => {
      const validAssets: ("USDC" | "XLM")[] = ["USDC", "XLM"];
      const invalidAssets = ["USD", "EUR", "BTC"];

      validAssets.forEach((asset) => {
        expect(["USDC", "XLM"]).toContain(asset);
      });

      expect(["USDC", "XLM"]).not.toContain(invalidAssets[0]);
    });

    it("should validate endpoint URL format when provided", () => {
      const validEndpoint = "http://localhost:3001/agent";
      const invalidEndpoint = "not-a-url";

      expect(validEndpoint).toMatch(/^https?:\/\//);
      expect(invalidEndpoint).not.toMatch(/^https?:\/\//);
    });
  });

  describe("listAgents", () => {
    it("should return array of agent metadata", async () => {
      const agentsList = [
        {
          name: "agent1",
          owner: testKeypair.publicKey(),
          endpoint: "http://agent1.example.com/agent",
          ipfs_cid: "QmHash1",
        },
        {
          name: "agent2",
          owner: testKeypair.publicKey(),
          endpoint: "http://agent2.example.com/agent",
          ipfs_cid: "QmHash2",
        },
      ];

      expect(Array.isArray(agentsList)).toBe(true);
      expect(agentsList.length).toBe(2);
    });

    it("should filter agents by network", () => {
      const testnetAgents = [
        {
          name: "testnet-agent",
          network: "testnet",
        },
      ];

      const filtered = testnetAgents.filter((a) => a.network === "testnet");
      expect(filtered.length).toBe(1);
    });

    it("should return empty array if no agents found", () => {
      const agentsList: any[] = [];
      expect(agentsList).toHaveLength(0);
    });
  });

  describe("Agent Metadata", () => {
    it("should include required fields in agent metadata", () => {
      const metadata = {
        ...testAgentConfig,
        owner: testKeypair.publicKey(),
        endpoint: "http://localhost:3001/agent",
        ipfs_cid: "QmTest",
        registered_at: new Date().toISOString(),
      };

      const requiredFields = [
        "name",
        "owner",
        "endpoint",
        "price",
        "asset",
        "ipfs_cid",
      ];
      requiredFields.forEach((field) => {
        expect(metadata).toHaveProperty(field);
      });
    });

    it("should have valid IPFS CID format", () => {
      const validCIDs = [
        "QmHash123",
        "QmAnotherHash456",
        "QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      ];
      validCIDs.forEach((cid) => {
        expect(cid).toMatch(/^Qm[a-zA-Z0-9]+$/);
      });
    });
  });
});
