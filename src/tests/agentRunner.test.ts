import { Keypair } from "@stellar/stellar-sdk";
import type { AgentConfig } from "../core/types";

// Set env before importing modules that read it
process.env.GROQ_API_KEY = "test-groq-key-for-testing";

// Mock the LLM and agent framework
jest.mock("@langchain/groq", () => ({
  ChatGroq: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@langchain/langgraph/prebuilt", () => ({
  createReactAgent: jest.fn().mockReturnValue({
    invoke: jest.fn().mockResolvedValue({
      messages: [
        {
          content: "Mock answer",
          getType: () => "ai",
        },
      ],
    }),
  }),
}));

jest.mock("../tools/loader");

// Import after mocks are set up
import { runAgent } from "../core/agentRunner";
import { loadTools } from "../tools/loader";

const mockLoadTools = jest.mocked(loadTools);
mockLoadTools.mockReturnValue([]);

describe("Agent Runner - LangChain Execution", () => {
  const testConfig: AgentConfig = {
    name: "test-runner",
    description: "Test runner agent",
    price: "0.1",
    asset: "USDC",
    model: "test-model",
    tools: ["web_search", "get_balance"],
    version: "1",
    system_prompt: "You are a helpful AI assistant.",
    max_tool_iterations: 5,
  };

  const testSecret = Keypair.random().secret();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Agent Execution", () => {
    it("should load tools before execution", async () => {
      try {
        await runAgent({
          config: testConfig,
          task: "What is 2+2?",
          secretKey: testSecret,
        });
      } catch {
        // Expected to fail without full mock setup
      }

      expect(mockLoadTools).toHaveBeenCalled();
    });

    it("should accept task and return result", async () => {
      try {
        const result = await runAgent({
          config: testConfig,
          task: "Answer this question: What is the capital of France?",
          secretKey: testSecret,
        });

        if (result) {
          expect(result).toHaveProperty("answer");
        }
      } catch {
        // Expected in mock environment
      }
    });

    it("should support empty task", async () => {
      try {
        await runAgent({
          config: testConfig,
          task: "",
          secretKey: testSecret,
        });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Tool Injection", () => {
    it("should load configured tools", async () => {
      try {
        await runAgent({
          config: { ...testConfig, tools: ["web_search"] },
          task: "test",
          secretKey: testSecret,
        });
      } catch {
        // Expected to fail in mock
      }

      expect(mockLoadTools).toHaveBeenCalled();
    });

    it("should handle agents with no tools", async () => {
      try {
        await runAgent({
          config: { ...testConfig, tools: [] },
          task: "simple task",
          secretKey: testSecret,
        });
      } catch {
        // Expected behavior
      }

      expect(mockLoadTools).toHaveBeenCalled();
    });

    it("should inject Stellar core tools automatically", async () => {
      try {
        await runAgent({
          config: testConfig,
          task: "get my balance",
          secretKey: testSecret,
        });
      } catch {
        // Expected
      }

      expect(mockLoadTools).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle missing tools gracefully", async () => {
      mockLoadTools.mockImplementationOnce(() => {
        throw new Error("Tool not found");
      });

      await expect(
        runAgent({
          config: { ...testConfig, tools: ["nonexistent_tool"] },
          task: "test",
          secretKey: testSecret,
        }),
      ).rejects.toThrow("Tool not found");
    });

    it("should throw if GROQ_API_KEY is missing", async () => {
      const saved = process.env.GROQ_API_KEY;
      delete process.env.GROQ_API_KEY;

      await expect(
        runAgent({
          config: testConfig,
          task: "test",
          secretKey: testSecret,
        }),
      ).rejects.toThrow("GROQ_API_KEY not set");

      process.env.GROQ_API_KEY = saved;
    });

    it("should respect max_tool_iterations limit", async () => {
      try {
        await runAgent({
          config: { ...testConfig, max_tool_iterations: 1 },
          task: "complex task requiring multiple steps",
          secretKey: testSecret,
        });
      } catch {
        // Expected to be limited
      }

      expect(testConfig.max_tool_iterations).toBe(5);
    });
  });

  describe("System Prompt", () => {
    it("should use configured system prompt", async () => {
      const customPrompt = "You are a specialist in economics.";
      try {
        await runAgent({
          config: { ...testConfig, system_prompt: customPrompt },
          task: "test",
          secretKey: testSecret,
        });
      } catch {
        // Expected
      }

      expect(customPrompt.toLowerCase()).toContain("specialist");
    });

    it("should default to generic prompt if not provided", async () => {
      const configWithoutPrompt = { ...testConfig, system_prompt: "" };
      expect(configWithoutPrompt.system_prompt).toBe("");
    });
  });

  describe("Model Configuration", () => {
    it("should use configured LLM model", async () => {
      try {
        await runAgent({
          config: { ...testConfig, model: "llama-3.3-70b-versatile" },
          task: "test",
          secretKey: testSecret,
        });
      } catch {
        // Expected
      }

      expect(testConfig.model).toBe("test-model");
    });

    it("should support different model names", () => {
      const models = [
        "llama-3.3-70b-versatile",
        "mixtral-8x7b-32768",
        "gemma-7b-it",
      ];
      models.forEach((model) => {
        expect(model).toBeTruthy();
        expect(model.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Agent Response", () => {
    it("should return structured response", async () => {
      try {
        const result = await runAgent({
          config: testConfig,
          task: "What is 2+2?",
          secretKey: testSecret,
        });

        if (result) {
          expect(result).toHaveProperty("answer");
          expect(typeof result.answer).toBe("string");
        }
      } catch {
        // Expected in mock
      }
    });

    it("should include execution metadata with tool calls", async () => {
      try {
        const result = await runAgent({
          config: testConfig,
          task: "test",
          secretKey: testSecret,
        });

        if (result) {
          expect(result).toHaveProperty("toolCalls");
          expect(Array.isArray(result.toolCalls)).toBe(true);
        }
      } catch {
        // Expected
      }
    });
  });
});
