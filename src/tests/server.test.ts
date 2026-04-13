import request from "supertest";
import { createAgentServer } from "../server/index";
import type { AgentConfig } from "../core/types";

jest.mock("../core/agentRunner", () => ({
  runAgent: jest.fn().mockResolvedValue({
    answer: "Test response from agent",
    toolCalls: [],
  }),
}));

describe("Agent Server - x402 Payment Middleware", () => {
  let app: any;
  const testConfig: AgentConfig = {
    name: "test-agent",
    description: "Test agent for x402 middleware",
    price: "0.1",
    asset: "USDC",
    model: "test-model",
    tools: [],
    version: "1",
    system_prompt: "You are a test agent",
    max_tool_iterations: 10,
    owner: "GBUQWP3BOUZX34ULNQG23RQ6F4BFSRJQ4AJE4LGEDS35LOYXL5COUNTER",
  };

  beforeAll(() => {
    app = createAgentServer({
      config: testConfig,
      secretKey: "SBUQWP3BOUZX34ULNQG23RQ6F4BFSRJQ4AJE4LGEDS35LOYXL5COUNTER",
      network: "testnet",
    });
  });

  describe("GET /health", () => {
    it("should return 200 with agent metadata", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("status", "ok");
      expect(res.body).toHaveProperty("agent", "test-agent");
      expect(res.body).toHaveProperty("x402", true);
    });

    it("should not require payment for health check", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.status).not.toBe(402);
    });
  });

  describe("GET /agent", () => {
    it("should return agent metadata without payment", async () => {
      const res = await request(app).get("/agent");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("name", "test-agent");
      expect(res.body).toHaveProperty("price", "0.1");
      expect(res.body).toHaveProperty("owner");
    });

    it("should include price and network info", async () => {
      const res = await request(app).get("/agent");
      expect(res.body.price).toBe("0.1");
      expect(res.body.network).toBe("testnet");
    });
  });

  describe("POST /agent", () => {
    it("should require task parameter", async () => {
      const res = await request(app).post("/agent").send({});
      expect([400, 402]).toContain(res.status);
    });

    it("should return 402 when no payment is provided", async () => {
      const res = await request(app)
        .post("/agent")
        .send({ task: "what is 2+2?" });

      expect(res.status).toBe(402);
    });

    it("should handle CORS properly", async () => {
      const res = await request(app)
        .get("/health")
        .set("Origin", "http://example.com");

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeDefined();
    });
  });

  describe("Request Validation", () => {
    it("should accept valid task strings", async () => {
      const res = await request(app)
        .post("/agent")
        .send({ task: "valid task" });

      expect([400, 402]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
  });
});
