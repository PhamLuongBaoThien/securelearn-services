type GeminiPart = { text: string };
type GeminiCandidate = { content?: { parts?: GeminiPart[] }; finishReason?: string };
type GeminiResponse = { candidates?: GeminiCandidate[]; error?: { message?: string } };

type GenerateResult = { reply: string; finishReason: string };

class GeminiService {
  async generateReply(input: { systemPrompt: string; prompt: string }): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;
    if (!apiKey || !model) {
      throw Object.assign(new Error("Gemini chưa được cấu hình. Vui lòng cấu hình GEMINI_API_KEY và GEMINI_MODEL."), { status: 503 });
    }

    const first = await this.requestGemini({ apiKey, model, systemPrompt: input.systemPrompt, prompt: input.prompt, maxOutputTokens: 1200 });
    if (first.finishReason !== "MAX_TOKENS") return first.reply;

    const retryPrompt = `${input.prompt}\n\nCâu trả lời trước đó bị dài và có nguy cơ bị cắt. Hãy trả lời lại hoàn chỉnh, ngắn gọn trong tối đa 5 câu, không mở danh sách nếu không đủ nội dung.`;
    const second = await this.requestGemini({ apiKey, model, systemPrompt: input.systemPrompt, prompt: retryPrompt, maxOutputTokens: 900 });
    return second.reply;
  }

  private async requestGemini(input: {
    apiKey: string;
    model: string;
    systemPrompt: string;
    prompt: string;
    maxOutputTokens: number;
  }): Promise<GenerateResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: { temperature: 0.25, maxOutputTokens: input.maxOutputTokens },
        }),
      });
      const data = (await response.json().catch(() => ({}))) as GeminiResponse;
      if (!response.ok) {
        const message = response.status === 429
          ? "Chatbot đang nhận quá nhiều yêu cầu. Vui lòng thử lại sau ít phút."
          : data.error?.message || "Gemini không thể tạo câu trả lời.";
        throw Object.assign(new Error(message), { status: response.status === 429 ? 429 : 502 });
      }
      const candidate = data.candidates?.[0];
      const reply = candidate?.content?.parts?.map((part) => part.text).join("\n").trim();
      if (!reply) throw Object.assign(new Error("Gemini không trả về nội dung phù hợp."), { status: 502 });
      return { reply, finishReason: candidate?.finishReason || "" };
    } catch (error: any) {
      if (error?.name === "AbortError") throw Object.assign(new Error("Chatbot phản hồi quá lâu. Vui lòng thử lại."), { status: 504 });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export default new GeminiService();
