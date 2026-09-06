type Env = Record<string, never>;

export default {
  fetch(): Response {
    return Response.json({
      name: "SmudgeWatch",
      status: "initializing",
    });
  },

  scheduled(): void {
    console.log("SmudgeWatch scheduled check initialized");
  },
} satisfies ExportedHandler<Env>;
