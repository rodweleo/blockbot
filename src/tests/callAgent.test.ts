import { callAgent } from "../core/callAgent";
import { getAccountBalances } from "../utils/stellar";
import { Keypair } from "@stellar/stellar-sdk";
import type { AgentMetadata } from "../core/types";
import { agentRegistry } from "../core/registry";

jest.mock("../core/registry");
jest.mock("../utils/stellar");
jest.mock("@x402/fetch");
jest.mock("@x402/stellar");

const mockResolveAgent = agentRegistry.resolveAgent as jest.MockedFunction<
  typeof agentRegistry.resolveAgent
>;
const mockGetAccountBalances = getAccountBalances as jest.MockedFunction<
  typeof getAccountBalances
>;

describe("callAgent - x402 Payment Client", () => {
  const testKeypair = Keypair.random();
  const payerSecret = testKeypair.secret();

  const agentMeta: AgentMetadata = {
    name: "test-agent",
    description: "Test agent",
    price: "0.1",
    asset: "USDC",
    model: "test-model",
    tools: [],
    version: "1",
    owner: testKeypair.publicKey(),
    endpoint: "http://localhost:3001/agent",
    ipfs_cid: "QmTest",
    registered_at: new Date().toISOString(),
    system_prompt: "Test",
    max_tool_iterations: 10,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveAgent.mockResolvedValue(agentMeta);
    mockGetAccountBalances.mockResolvedValue([
      { asset: "USDC", balance: "1.0" },
      { asset: "XLM", balance: "100.0" },
    ]);
  });

  describe("Agent Resolution", () => {
    it("should resolve agent by name", async () => {
      const result = await callAgent({
        nameOrAddress: "test-agent",
        task: "test task",
        payerKeypair: payerSecret,
        network: "testnet",
      });

      expect(mockResolveAgent).toHaveBeenCalledWith("test-agent", "testnet");
    });

    it("should return error result if agent not found", async () => {
      mockResolveAgent.mockRejectedValue(new Error("Agent not found"));

      const result = await callAgent({
        nameOrAddress: "nonexistent",
        task: "test task",
        payerKeypair: payerSecret,
        network: "testnet",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Agent not found");
    });
  });

  describe("Balance Validation", () => {
    it("should check caller balance before making payment", async () => {
      mockGetAccountBalances.mockResolvedValue([
        { asset: "USDC", balance: "0.05" },
      ]);

      const result = await callAgent({
        nameOrAddress: "test-agent",
        task: "test task",
        payerKeypair: payerSecret,
        network: "testnet",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient USDC balance");
    });

    it("should proceed if balance is sufficient", async () => {
      mockGetAccountBalances.mockResolvedValue([
        { asset: "USDC", balance: "1.0" },
      ]);

      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Network mock - test stops here"));

      const result = await callAgent({
        nameOrAddress: "test-agent",
        task: "test task",
        payerKeypair: payerSecret,
        network: "testnet",
      });

      // It should have gotten past balance check even if it fails later
      expect(mockGetAccountBalances).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot reach agent endpoint");
    });
  });

  describe("Network Configuration", () => {
    it("should use testnet by default", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Network mock - test stops here"));

      const result = await callAgent({
        nameOrAddress: "test-agent",
        task: "test task",
        payerKeypair: payerSecret,
      });

      expect(result.success).toBe(false);
      expect(mockResolveAgent).toHaveBeenCalledWith("test-agent", "testnet");
    });

    it("should support mainnet network", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Network mock - test stops here"));

      const result = await callAgent({
        nameOrAddress: "test-agent",
        task: "test task",
        payerKeypair: payerSecret,
        network: "mainnet",
      });

      expect(result.success).toBe(false);
      expect(mockResolveAgent).toHaveBeenCalledWith("test-agent", "mainnet");
    });
  });

  describe("Step Logging", () => {
    it("should call onStep callback for each step", async () => {
      const onStep = jest.fn();
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Network mock - test stops here"));

      try {
        await callAgent({
          nameOrAddress: "test-agent",
          task: "test task",
          payerKeypair: payerSecret,
          network: "testnet",
          onStep,
        });
      } catch {
        // Expected to fail in mock
      }

      expect(onStep.mock.calls.length).toBeGreaterThan(0);
    });
  });
});
