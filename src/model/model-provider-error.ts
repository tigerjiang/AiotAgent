import OpenAI from "openai";
//这个错误属于业务抽象层，不包含OpenAI字样。以后切换到Qwen、DeepSeek或本地模型时仍然可以复用。
export type ModelProviderErrorCode = 
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "CONNECTION"
  | "INVALID_REQUEST"
  | "UPSTREAM"
  | "UNKNOWN";

  export class ModelProviderError extends Error{
    constructor(
        public readonly code:ModelProviderErrorCode,
        message : string
    ){
        super(message);
        this.name ="ModelProviderError"
    }
  }

  export function normalizeOpenAIError(error: unknown): ModelProviderError {

    if (error instanceof OpenAI.AuthenticationError) {
        return new ModelProviderError(
            "AUTHENTICATION",
            "Model provider authentication failed."
        )
    }

    if (error instanceof OpenAI.RateLimitError) {
        return new ModelProviderError(
            "RATE_LIMIT",
            "Model provider rate limit was reached."
        );
    }

    // 必须放在APIConnectionError之前
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
        return new ModelProviderError(
            "TIMEOUT",
            "Model provider request timed out."
        );
    }
    if (error instanceof OpenAI.APIConnectionError) {
        return new ModelProviderError(
            "CONNECTION",
            "Unable to connect to the model provider."
        );
    }
    if (error instanceof OpenAI.BadRequestError) {
        return new ModelProviderError(
            "INVALID_REQUEST",
            "The model provider rejected the request."
        );
    }
    if (error instanceof OpenAI.InternalServerError) {
        return new ModelProviderError(
            "UPSTREAM",
            "The model provider is temporarily unavailable."
        );
    }


    return new ModelProviderError(
        "UNKNOWN",
        error instanceof Error ? error.message : "Unknown model provider error."
    );
}