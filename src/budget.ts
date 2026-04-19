import type { Config } from './config.js';

function utcDayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface BudgetSnapshot {
  dayKey: string;
  minutesUsed: number;
  tokensUsed: number;
  sttCap: number;
  llmCap: number;
}

export interface Budget {
  addMinutes(n: number): void;
  addTokens(n: number): void;
  checkStt(): { ok: boolean; remaining: number };
  checkLlm(): { ok: boolean; remaining: number };
  snapshot(): BudgetSnapshot;
}

export function createBudget(cfg: Config): Budget {
  let state = { dayKey: utcDayKey(), minutesUsed: 0, tokensUsed: 0 };

  const rollOver = () => {
    const today = utcDayKey();
    if (today !== state.dayKey) {
      state = { dayKey: today, minutesUsed: 0, tokensUsed: 0 };
    }
  };

  return {
    addMinutes(n) {
      if (!Number.isFinite(n) || n <= 0) return;
      rollOver();
      state.minutesUsed += n;
    },
    addTokens(n) {
      if (!Number.isFinite(n) || n <= 0) return;
      rollOver();
      state.tokensUsed += n;
    },
    checkStt() {
      rollOver();
      const remaining = Math.max(0, cfg.STT_DAILY_MINUTES_CAP - state.minutesUsed);
      return { ok: state.minutesUsed < cfg.STT_DAILY_MINUTES_CAP, remaining };
    },
    checkLlm() {
      rollOver();
      const remaining = Math.max(0, cfg.LLM_DAILY_TOKENS_CAP - state.tokensUsed);
      return { ok: state.tokensUsed < cfg.LLM_DAILY_TOKENS_CAP, remaining };
    },
    snapshot() {
      rollOver();
      return {
        dayKey: state.dayKey,
        minutesUsed: state.minutesUsed,
        tokensUsed: state.tokensUsed,
        sttCap: cfg.STT_DAILY_MINUTES_CAP,
        llmCap: cfg.LLM_DAILY_TOKENS_CAP,
      };
    },
  };
}
