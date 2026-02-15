const CATEGORY_META = {
  groceries: { label: 'Groceries', icon: '🛒' },
  dining: { label: 'Dining', icon: '🍽️' },
  transportation: { label: 'Transportation', icon: '🚗' },
  entertainment: { label: 'Entertainment', icon: '🎬' },
  shopping: { label: 'Shopping', icon: '🛍️' },
  subscription: { label: 'Subscription', icon: '📱' },
  other: { label: 'Other', icon: '📦' },
};

const KEYWORD_RULES = {
  groceries: ['whole foods', 'trader joes', 'safeway', 'kroger', 'grocery', 'supermarket', 'costco', 'aldi'],
  dining: ['restaurant', 'cafe', 'coffee', 'starbucks', 'chipotle', 'doordash', 'ubereats', 'grubhub', 'bar', 'bistro', 'pizza'],
  transportation: ['gas', 'shell', 'chevron', 'exxon', 'uber', 'lyft', 'parking', 'metro', 'toll', 'transit'],
  entertainment: ['movie', 'amc', 'netflix', 'spotify', 'hulu', 'disney', 'theater', 'concert', 'ticketmaster'],
  shopping: ['amazon', 'ebay', 'etsy', 'target', 'walmart', 'store', 'shop'],
  subscription: ['subscription', 'prime', 'premium', 'membership', 'icloud', 'google one', 'adobe'],
};

function normalizeCategory(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (CATEGORY_META[raw]) return raw;

  if (raw.includes('food')) return 'dining';
  if (raw.includes('grocer')) return 'groceries';
  if (raw.includes('transport') || raw.includes('travel')) return 'transportation';
  if (raw.includes('entertain')) return 'entertainment';
  if (raw.includes('shop') || raw.includes('retail')) return 'shopping';
  if (raw.includes('subscription') || raw.includes('stream')) return 'subscription';

  return 'other';
}

function ruleBasedCategory(transaction) {
  const name = `${transaction.name || ''} ${transaction.merchant_name || ''}`.toLowerCase();
  for (const [category, keywords] of Object.entries(KEYWORD_RULES)) {
    if (keywords.some((keyword) => name.includes(keyword))) {
      return category;
    }
  }

  const plaidCandidates = [
    transaction.personal_finance_category?.primary,
    transaction.personal_finance_category?.detailed,
    ...(Array.isArray(transaction.category) ? transaction.category : []),
  ];

  for (const candidate of plaidCandidates) {
    const normalized = normalizeCategory(candidate);
    if (normalized !== 'other') return normalized;
  }

  return 'other';
}

async function categorizeWithOpenAI(transactions) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !transactions.length) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const payload = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You categorize bank transactions. Return JSON only. Allowed categories: groceries, dining, transportation, entertainment, shopping, subscription, other.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          instructions:
            'For each transaction index, choose the best allowed category based on merchant, name, amount sign, and plaid categories.',
          transactions: transactions.map((tx, index) => ({
            index,
            name: tx.name,
            merchant_name: tx.merchant_name,
            amount: tx.amount,
            account: tx.account,
            plaid_category: tx.category,
            personal_finance_category: tx.personal_finance_category,
          })),
          output_shape: {
            categories: [{ index: 0, category: 'dining' }],
          },
        }),
      },
    ],
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI categorization failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return null;

  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed?.categories)) return null;

  const map = new Map();
  parsed.categories.forEach((item) => {
    if (!Number.isInteger(item?.index)) return;
    map.set(item.index, normalizeCategory(item.category));
  });

  return transactions.map((tx, index) => map.get(index) || ruleBasedCategory(tx));
}

async function categorizeTransactions(transactions) {
  let aiCategories = null;
  try {
    aiCategories = await categorizeWithOpenAI(transactions);
  } catch (error) {
    console.warn('Falling back to rule-based categorization:', error.message);
  }

  return transactions.map((transaction, index) => {
    const category = aiCategories?.[index] || ruleBasedCategory(transaction);
    const meta = CATEGORY_META[category] || CATEGORY_META.other;
    return {
      ...transaction,
      category,
      categoryLabel: meta.label,
      categoryIcon: meta.icon,
    };
  });
}

module.exports = {
  CATEGORY_META,
  categorizeTransactions,
  normalizeCategory,
};
