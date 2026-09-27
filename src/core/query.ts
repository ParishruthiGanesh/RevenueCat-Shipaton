import { normalize } from './text';

/**
 * Deterministic natural-language understanding for questions and voice commands.
 * Covers the common phrasings instantly and offline; anything it can't parse is sent to the
 * cloud interpreter (supabase/functions/interpret), which returns the SAME structured shape.
 */

export type QueryIntent =
  | 'find'
  | 'contents'
  | 'history'
  | 'usual'
  | 'last_seen_time'
  | 'was_ever_in'
  | 'previous'
  | 'lent_list'
  | 'inventory'
  | 'stale'
  | 'uncertain'
  | 'changes'
  | 'moves'
  | 'storage'
  | 'away'
  | 'misplaced'
  | 'not_scanned';

export interface ParsedQuery {
  intent: QueryIntent;
  subject?: string;
  place?: string;
  person?: string;
  /** "which box", "which drawer" — the user wants the container. */
  containerType?: string;
  sinceDays?: number;
  raw: string;
  /** Parser confidence that it understood the question. */
  confidence: number;
}

const strip = (s: string) =>
  s
    .replace(/^(the|my|a|an|our|your)\s+/i, '')
    .replace(/[?.!]+$/, '')
    .trim();

function timeWindow(q: string): number | undefined {
  if (/\btoday\b/.test(q)) return 1;
  if (/\byesterday\b/.test(q)) return 2;
  if (/\bthis week\b|\bpast week\b|\blast week\b/.test(q)) return 7;
  if (/\bthis month\b|\blast month\b|\bpast month\b/.test(q)) return 31;
  const m = q.match(/(?:in|over|for) (?:more than |over )?(?:a |an |(\d+) )?(day|week|month|year)s?/);
  if (m) {
    const n = m[1] ? parseInt(m[1], 10) : 1;
    return n * { day: 1, week: 7, month: 30, year: 365 }[m[2] as 'day' | 'week' | 'month' | 'year'];
  }
  return undefined;
}

function ownerSplit(subject: string): { subject: string; person?: string } {
  const m = subject.match(/^([A-Z][a-zA-Z]+|mom|dad|mum)['’]s\s+(.+)$/i);
  if (m && !/^(it|that|this|what|where|who)$/i.test(m[1])) return { person: m[1], subject: m[2] };
  const b = subject.match(/^(.+?)\s+(?:belonging to|that belongs? to|owned by)\s+(.+)$/i);
  if (b) return { subject: b[1], person: b[2] };
  return { subject };
}

export function parseQuery(input: string): ParsedQuery {
  const raw = input.trim();
  const q = normalize(raw.replace(/[’]/g, "'")).replace(/\bwhere s\b/g, 'where is').replace(/\bwhat s\b/g, 'what is');
  const r = raw.replace(/[?.!]+$/, '').trim();
  const out = (p: Omit<ParsedQuery, 'raw'>): ParsedQuery => ({ ...p, raw });
  let m: RegExpMatchArray | null;

  // ── meta questions over the whole memory ──
  if (/\b(uncertain|unsure|not sure)\b.*\b(location|where)|\bwhat (objects|things|items) have uncertain/.test(q)) return out({ intent: 'uncertain', confidence: 0.9 });
  if (/(haven t|havent|have not|not) been (scanned|checked)|hasn t been scanned|not scanned/.test(q)) return out({ intent: 'not_scanned', sinceDays: timeWindow(q) ?? 30, confidence: 0.85 });
  if (/(most|commonly|often) (misplaced|lost|moved)/.test(q)) return out({ intent: 'misplaced', confidence: 0.9 });
  if (/away from (their|its) usual|not where (they|it) usually|out of place/.test(q)) return out({ intent: 'away', confidence: 0.9 });
  if (/(haven t|havent|have not|not) (seen|been (seen|observed|used))|not (been )?observed|no recorded/.test(q)) return out({ intent: 'stale', sinceDays: timeWindow(q) ?? 180, confidence: 0.85 });
  if (/\b(lent|lend|loaned|borrowed)\b/.test(q) && /\b(what|which|things|items|everything|list|out)\b/.test(q) && !/\bwhere\b/.test(q)) {
    m = q.match(/\bto ([a-z]+)\b/);
    return out({ intent: 'lent_list', person: m?.[1], confidence: 0.9 });
  }
  if (/\b(in|into) storage\b/.test(q)) return out({ intent: 'storage', confidence: 0.85 });
  if ((m = r.match(/what (?:has )?changed (?:in|at) (?:my |the )?(.+?)(?:\s+(?:this|last|since|today|yesterday|over|in the).*)?$/i))) {
    return out({ intent: 'changes', place: strip(m[1]), sinceDays: timeWindow(q) ?? 7, confidence: 0.9 });
  }
  if (/what (did i|have i) move/.test(q)) return out({ intent: 'moves', sinceDays: timeWindow(q) ?? 2, confidence: 0.9 });

  // ── object-specific questions ──
  if ((m = r.match(/where (?:do|did) (?:i|we) (?:usually|normally|typically|generally) (?:keep|put|leave|store) (?:my |the |our )?(.+)$/i)))
    return out({ intent: 'usual', ...ownerSplit(strip(m[1])), confidence: 0.95 });
  if ((m = r.match(/when (?:did|was) (?:i|it)? ?(?:last )?(?:see|saw|seen)? ?(?:my |the )?(.+?)(?: last seen)?$/i)) && /\blast\b/.test(q))
    return out({ intent: 'last_seen_time', ...ownerSplit(strip(m[1])), confidence: 0.9 });
  if ((m = r.match(/was (?:my |the )?(.+?) ever (?:in|on|inside) (?:my |the )?(.+)$/i)))
    return out({ intent: 'was_ever_in', ...ownerSplit(strip(m[1])), place: strip(m[2]), confidence: 0.95 });
  if ((m = r.match(/where was (?:my |the )?(.+?) before/i))) return out({ intent: 'previous', ...ownerSplit(strip(m[1])), confidence: 0.9 });
  if ((m = r.match(/(?:history of|timeline (?:of|for)|where has) (?:my |the )?(.+?)(?: been)?$/i))) return out({ intent: 'history', ...ownerSplit(strip(m[1])), confidence: 0.9 });

  if ((m = r.match(/^(?:how many|do i (?:already )?(?:own|have)|have i got|what) (?:an? |any )?(.+?)(?: do i (?:own|have))?$/i)) && /\b(how many|own|have i got|do i have)\b/.test(q))
    return out({ intent: 'inventory', subject: strip(m[1]), confidence: 0.85 });
  if ((m = r.match(/^(?:what|which) (?:\w+ )?(?:batteries|chargers|cables|tools)\b/i))) return out({ intent: 'inventory', subject: m[0].split(' ').pop(), confidence: 0.75 });

  // "which box has the coffee grinder" / "what drawer has my documents"
  if ((m = r.match(/^(?:which|what) (box|drawer|shelf|bag|cabinet|container|suitcase|bin|room|pouch) (?:has|contains|holds|is) (?:my |the )?(.+)$/i)))
    return out({ intent: 'find', containerType: m[1].toLowerCase(), ...ownerSplit(strip(m[2])), confidence: 0.95 });

  // "what's in box 17", "what is inside the top drawer", "which things are in the attic"
  if ((m = r.match(/^(?:what(?:'s| is| are)?|which (?:things|items|objects)(?: are)?|show(?: me)?|list)(?: all)?(?: (?:the )?(?:things|items|stuff|objects))?(?: belonging to (\w+))? (?:currently )?(?:is |are )?(?:in|inside|on|at) (?:my |the |our )?(.+)$/i)))
    return out({ intent: 'contents', place: strip(m[2]), person: m[1], confidence: 0.9 });
  if ((m = r.match(/^(?:what'?s|what is) (?:in|inside) (.+)$/i))) return out({ intent: 'contents', place: strip(m[1]), confidence: 0.9 });

  // "where is my passport", "where did I put my AirPods", "find my travel charger", "who has my camera"
  if (
    (m = r.match(/^(?:where(?:'s| is| are)|where did (?:i|we|you see) (?:put|leave|last see|see)|where have i (?:put|left)|have you seen|find|locate|looking for|i can'?t find|i lost|who has|show me)\s+(?:my |the |our |that |those )?(.+)$/i))
  ) {
    return out({ intent: 'find', ...ownerSplit(strip(m[1])), confidence: 0.95 });
  }

  // Bare noun phrase: treat as a find, lower confidence.
  const bare = strip(r.replace(/^(where|what|which|find)\b\s*/i, ''));
  return out({ intent: 'find', ...ownerSplit(bare), confidence: bare.split(/\s+/).length <= 6 ? 0.6 : 0.35 });
}

// ───────────────────────────── voice commands ─────────────────────────────

export type VoiceCommand =
  | { action: 'remember'; item?: string; place?: string }
  | { action: 'label'; name: string }
  | { action: 'alias'; alias: string }
  | { action: 'lend'; item?: string; person: string }
  | { action: 'move_box'; box?: string; place: string }
  | { action: 'ask'; query: ParsedQuery };

/** Interprets what the user SAID while capturing, e.g. "Remember I'm putting this charger in the second desk drawer." */
export function parseVoiceCommand(input: string): VoiceCommand {
  const r = input.trim().replace(/[.!]+$/, '');
  let m: RegExpMatchArray | null;
  if ((m = r.match(/^(?:call|name) (?:this|it|that) (?:my |the )?(.+)$/i))) return { action: 'alias', alias: strip(m[1]) };
  if ((m = r.match(/^(?:i(?:'m| am)? )?(?:lent|lend|lending|gave|loaned) (?:my |this |the |that )?(.*?)\s*to ([A-Z]?[a-z]+(?: [A-Z][a-z]+)?)$/i)))
    return { action: 'lend', item: m[1] && !/^(this|it|that)$/i.test(m[1]) ? strip(m[1]) : undefined, person: m[2] };
  if ((m = r.match(/^(?:this|the) (box(?: \d+)?|bin|crate) (?:goes|is going|went|is) (?:in|into|to|on) (?:the |my )?(.+)$/i))) return { action: 'move_box', box: m[1], place: strip(m[2]) };
  if ((m = r.match(/^(?:these|this|they) (?:are|is) (?:my |the |our )?(.+)$/i))) return { action: 'label', name: strip(m[1]) };
  if (
    (m = r.match(
      /^(?:remember|note)?\s*(?:that )?(?:where )?(?:i(?:'m| am)?|we(?:'re| are)?) (?:putting|leaving|storing|keeping|placing|put|left|stored) (?:my |this |the |these |our )?(.*?)(?:\s+(?:in|into|on|under|inside|next to|at)\s+(?:the |my |our )?(.+))?$/i,
    ))
  ) {
    const item = m[1] && !/^(this|it|that|them|these)$/i.test(m[1]) ? strip(m[1]) : undefined;
    return { action: 'remember', item, place: m[2] ? strip(m[2]) : undefined };
  }
  if ((m = r.match(/^remember (?:my |this |the )?(.+?)(?:\s+(?:is )?(?:in|on|inside|under) (?:the |my )?(.+))?$/i))) {
    return { action: 'remember', item: /^(this|it|that)$/i.test(m[1]) ? undefined : strip(m[1]), place: m[2] ? strip(m[2]) : undefined };
  }
  return { action: 'ask', query: parseQuery(r) };
}
