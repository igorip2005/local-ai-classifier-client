export type Classification = {
  label: string;
  confidence: number;
  reason: string;
};

const RULES = [
  {
    label: 'sales',
    patterns: [
      /сколько\s+стоит/i,
      /цен[ауые]/i,
      /стоимость/i,
      /прайс/i,
      /тариф/i,
      /купить/i,
      /подключени[ея]/i,
      /\bprice\b/i,
      /\bbuy\b/i,
      /\bpricing\b/i,
      /\bquote\b/i,
      /\benterprise\s+plan\b/i,
      /\bsubscription\b/i,
      /\blicen[cs]e/i,
      /\bannual\s+plan\b/i
    ]
  },
  {
    label: 'support',
    patterns: [
      /не\s+работает/i,
      /ошибк[аи]/i,
      /не\s+могу\s+войти/i,
      /сломал[оаи]?сь/i,
      /помогите/i,
      /не\s+проходит\s+оплат/i,
      /плат[её]ж\s+не\s+прош[её]л/i,
      /завис[а-я]*\s+при\s+оплат/i,
      /оплат[а-я]*\s+завис/i,
      /\berror\b/i,
      /\bissue\b/i,
      /\bcan'?t\s+log\s*in\b/i,
      /\bpayment\s+failed\b/i,
      /\bapp\s+crashes\b/i,
      /\bcheckout\s+crash/i
    ]
  },
  {
    label: 'spam',
    patterns: [
      /скидк[а-я]*\s+\d+%/i,
      /вы\s+выиграли/i,
      /выиграли\s+бонус/i,
      /заработ[а-я]+\s+быстро/i,
      /быстр[а-я]+\s+заработ/i,
      /бесплатн[а-я]+\s+реклам/i,
      /\bcasino\b/i,
      /\bcrypto\b/i,
      /\bguaranteed\s+income\b/i,
      /\blimited\s+time\s+offer\b/i,
      /\bfree\s+traffic\b/i
    ]
  },
  {
    label: 'other',
    patterns: [
      /добрый\s+день/i,
      /получил[аи]?\s+ваше\s+письмо/i,
      /\bок\b/i,
      /принято/i,
      /спасибо/i,
      /вернусь\s+позже/i,
      /созвон\s+завтра/i,
      /посмотрю\s+документ/i,
      /\bhello\b/i,
      /\bnoted\b/i,
      /\bthanks?\b/i,
      /\bcome\s+back\s+later\b/i,
      /\breview\s+the\s+document\b/i,
      /\bmeeting\s+tomorrow\b/i
    ]
  }
];

export function classifyByKeywords(text: string, classes: string[]): Classification | null {
  for (const rule of RULES) {
    if (!classes.includes(rule.label)) continue;
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return { label: rule.label, confidence: 0.88, reason: `Keyword guardrail matched ${rule.label}` };
    }
  }
  return classes.includes('other') ? { label: 'other', confidence: 0.4, reason: 'No keyword guardrail matched' } : null;
}

export function applyClassificationGuardrails(
  modelOutput: Classification,
  text: string,
  classes: string[]
): Classification {
  const guardrail = classifyByKeywords(text, classes);
  if (!guardrail) return modelOutput;
  if (guardrail.label === 'other' && guardrail.confidence >= 0.75) return guardrail;
  if (guardrail.label === 'other') return modelOutput;
  if (modelOutput.label === guardrail.label && modelOutput.confidence >= 0.5) return modelOutput;
  return guardrail;
}
