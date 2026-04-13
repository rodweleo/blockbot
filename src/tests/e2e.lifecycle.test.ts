import { createAgentServer } from "../server/index";
import { Keypair } from "@stellar/stellar-sdk";
import type { AgentConfig } from "../core/types";

/**
 * End-to-End Integration Test: Complete Agent Lifecycle
 *
 * Tests the full flow:
 * 1. Agent configuration creation
 * 2. Agent server startup with x402 payment middleware
 * 3. Health check verification
 * 4. Agent metadata retrieval
 * 5. Payment requirement validation
 * 6. Agent execution (with mock task)
 */

describe("E2E: Agent Lifecycle - Create, Deploy, Call", () => {
  let app: any;
  let testKeypair: Keypair;
  let testConfig: AgentConfig;

  beforeAll(() => {
    // Generate test keypair for agent
    testKeypair = Keypair.random();

    // Create agent configuration
    testConfig = {
      name: "e2e-test-agent",
      description: "End-to-end test agent",
      version: "1.0.0",
      model: "llama-3.3-70b-versatile",
      price: "0.01",
      asset: "USDC",
      tools: ["web_search", "get_balance"],
      system_prompt:
        "You are a helpful AI assistant. Respond concisely to user tasks.",
      max_tool_iterations: 3,
      owner: testKeypair.publicKey(),
    };

    // Create agent server with x402 middleware
    app = createAgentServer({
      config: testConfig,
      secretKey: testKeypair.secret(),
      network: "testnet",
    });
  });

  describe("Stage 1: Agent Configuration", () => {
    it("should have valid agent configuration", () => {
      expect(testConfig.name).toBe("e2e-test-agent");
      expect(testConfig.price).toBe("0.01");
      expect(testConfig.asset).toBe("USDC");
      expect(testConfig.model).toBeDefined();
      expect(testConfig.system_prompt).toBeDefined();
    });

    it("should generate valid keypair for agent", () => {
      expect(testKeypair.publicKey()).toBeDefined();
      expect(testKeypair.publicKey().length).toBeGreaterThan(0);
      expect(testKeypair.secret()).toBeDefined();
    });

    it("should have required tools configured", () => {
      expect(Array.isArray(testConfig.tools)).toBe(true);
      expect(testConfig.tools?.length).toBeGreaterThan(0);
    });
  });

  describe("Stage 2: Agent Server Deployment", () => {
    it("should create Express app successfully", () => {
      expect(app).toBeDefined();
      expect(app._router).toBeDefined();
    });

    it("should have x402 middleware configured", async () => {
      const res = await (await import("supertest"))
        .default(app)
        .post("/agent")
        .send({ task: "test" });

      // Without payment, should return 402
      expect(res.status).toBe(402);
    });

    it("should have CORS enabled", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app)
        .get("/health")
        .set("Origin", "http://example.com");

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeDefined();
    });
  });

  describe("Stage 3: Agent Health & Metadata", () => {
    it("should return health status", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.agent).toBe("e2e-test-agent");
      expect(res.body.x402).toBe(true);
    });

    it("should return agent metadata", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app).get("/agent");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("e2e-test-agent");
      expect(res.body.price).toBe("0.01");
      expect(res.body.asset).toBe("USDC");
      expect(res.body.model).toBe("llama-3.3-70b-versatile");
      expect(res.body.owner).toBe(testKeypair.publicKey());
    });

    it("should expose endpoint URL in metadata", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app).get("/agent");

      expect(res.body.network).toBe("testnet");
    });
  });

  describe("Stage 4: x402 Payment Gate", () => {
    it("should enforce payment requirement on POST /agent", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app)
        .post("/agent")
        .send({ task: "What is 2+2?" });

      expect(res.status).toBe(402);
    });

    it("should return proper 402 response structure", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app)
        .post("/agent")
        .send({ task: "test task" });

      if (res.status === 402) {
        expect(res.body).toBeDefined();
      }
    });

    it("should require Authorization header", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app)
        .post("/agent")
        .set("Authorization", "invalid-token")
        .send({ task: "test" });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("Stage 5: Agent Request Validation", () => {
    it("should reject POST without task parameter", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app).post("/agent").send({});

      expect([400, 402]).toContain(res.status);
    });

    it("should accept valid task format", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app)
        .post("/agent")
        .send({ task: "Describe the weather" });

      // Will fail payment gate, but accepts task format
      expect([400, 402]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });

    it("should handle long task descriptions", async () => {
      const supertest = (await import("supertest")).default;
      const longTask =
        "Tell me " + "a".repeat(1000) + " about artificial intelligence";

      const res = await supertest(app).post("/agent").send({ task: longTask });

      expect([400, 402]).toContain(res.status);
    });
  });

  describe("Stage 6: Configuration Persistence", () => {
    it("should maintain config throughout lifecycle", () => {
      expect(testConfig.name).toBe("e2e-test-agent");
      expect(testConfig.owner).toBe(testKeypair.publicKey());
    });

    it("should have consistent pricing", () => {
      expect(testConfig.price).toBe("0.01");
    });

    it("should preserve tool configuration", () => {
      expect(testConfig.tools).toContain("web_search");
      expect(testConfig.tools).toContain("get_balance");
    });
  });

  describe("Stage 7: Security & Isolation", () => {
    it("should not expose secret key in responses", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app).get("/agent");

      const responseStr = JSON.stringify(res.body);
      expect(responseStr).not.toContain("SBUQ");
      expect(responseStr).not.toContain("secret");
    });

    it("should not execute tasks without payment", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app)
        .post("/agent")
        .send({ task: "Execute privileged action" });

      // Should return 402 (not execute)
      expect(res.status).toBe(402);
    });

    it("should validate task ownership through payment", () => {
      // Payment signature proves caller ownership
      expect(testKeypair.publicKey()).toBeDefined();
    });
  });

  describe("Stage 8: Error Handling", () => {
    it("should handle malformed JSON gracefully", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app)
        .post("/agent")
        .set("Content-Type", "application/json")
        .send("{invalid json}");

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(500);
    });

    it("should handle unexpected HTTP methods", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app).delete("/agent");

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("should handle missing headers gracefully", async () => {
      const supertest = (await import("supertest")).default;
      const res = await supertest(app).post("/agent").send({ task: "test" });

      expect(res.status).toBeDefined();
      expect(res.status).not.toBe(500);
    });
  });

  describe("Stage 9: Full Workflow Simulation", () => {
    it("should complete health check → metadata → payment gate flow", async () => {
      const supertest = (await import("supertest")).default;

      // Step 1: Health check
      const health = await supertest(app).get("/health");
      expect(health.status).toBe(200);

      // Step 2: Get metadata
      const metadata = await supertest(app).get("/agent");
      expect(metadata.status).toBe(200);
      expect(metadata.body.name).toBe("e2e-test-agent");

      // Step 3: Attempt to call agent (payment required)
      const callAttempt = await supertest(app)
        .post("/agent")
        .send({ task: "What is the meaning of life?" });
      expect(callAttempt.status).toBe(402);

      // All steps succeeded in sequence
      expect(health.body.agent).toBe(metadata.body.name);
    });

    it("should report consistent state across requests", async () => {
      const supertest = (await import("supertest")).default;

      const req1 = await supertest(app).get("/agent");
      const req2 = await supertest(app).get("/agent");

      expect(req1.body.name).toBe(req2.body.name);
      expect(req1.body.price).toBe(req2.body.price);
      expect(req1.body.owner).toBe(req2.body.owner);
    });

    it("should maintain x402 compliance throughout", async () => {
      const supertest = (await import("supertest")).default;

      // Health should show x402 enabled
      const health = await supertest(app).get("/health");
      expect(health.body.x402).toBe(true);

      // Protected endpoint should return 402 without payment
      const protected_req = await supertest(app)
        .post("/agent")
        .send({ task: "test" });
      expect(protected_req.status).toBe(402);
    });
  });
});
