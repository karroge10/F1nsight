// Resolves the nationality and country strings in the data to ISO 3166-1 alpha-2 codes, which
// name the flag files in public/flags. The data carries three kinds of input: nationality
// adjectives ("British"), country names ("UK", "United States") and three-letter codes, mostly
// ISO alpha-3 ("GBR") with a few FIA codes mixed in ("DEN", "MON"). Historic states without a
// flag file (East Germany, Rhodesia) resolve to null.

/** ISO alpha-2 for a nationality, a country name or a three-letter code; null when unknown. */
export function countryIso2(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  if (key === "") return null;
  const byName = BY_NAME[key];
  if (byName !== undefined) return byName;
  const upper = key.toUpperCase();
  const byCode = BY_CODE[upper];
  if (byCode !== undefined) return byCode;
  if (/^[a-z]{2}$/.test(key) && ISO2.has(upper)) return upper;
  return null;
}

/** First resolvable value wins: pass the most specific source (nationality, name) before codes. */
export function firstCountryIso2(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const code = countryIso2(value);
    if (code) return code;
  }
  return null;
}

/** [alpha-2, alpha-3, other codes, names and nationality adjectives]. */
const COUNTRIES: [string, string, string[], string[]][] = [
  ["AE", "ARE", ["UAE"], ["united arab emirates", "uae", "abu dhabi", "emirati"]],
  ["AR", "ARG", [], ["argentina", "argentine", "argentinian", "argentinean"]],
  ["AT", "AUT", [], ["austria", "austrian"]],
  ["AU", "AUS", [], ["australia", "australian"]],
  ["AZ", "AZE", [], ["azerbaijan", "azerbaijani", "azeri"]],
  ["BE", "BEL", [], ["belgium", "belgian"]],
  ["BH", "BHR", [], ["bahrain", "bahraini"]],
  ["BR", "BRA", [], ["brazil", "brazilian"]],
  ["CA", "CAN", [], ["canada", "canadian"]],
  ["CH", "CHE", ["SUI"], ["switzerland", "swiss"]],
  ["CL", "CHL", ["CHI"], ["chile", "chilean"]],
  ["CN", "CHN", [], ["china", "chinese"]],
  ["CO", "COL", [], ["colombia", "colombian"]],
  ["CZ", "CZE", [], ["czech republic", "czechia", "czech"]],
  ["DE", "DEU", ["GER"], ["germany", "german", "west german", "west germany"]],
  ["DK", "DNK", ["DEN"], ["denmark", "danish", "dane"]],
  ["EE", "EST", [], ["estonia", "estonian"]],
  ["ES", "ESP", [], ["spain", "spanish"]],
  ["FI", "FIN", [], ["finland", "finnish"]],
  ["FR", "FRA", [], ["france", "french"]],
  ["GB", "GBR", ["UK"], ["united kingdom", "uk", "great britain", "britain", "england", "british", "english", "scottish", "welsh", "northern irish"]],
  ["HK", "HKG", [], ["hong kong"]],
  ["HU", "HUN", [], ["hungary", "hungarian"]],
  ["ID", "IDN", ["INA"], ["indonesia", "indonesian"]],
  ["IE", "IRL", [], ["ireland", "irish"]],
  ["IL", "ISR", [], ["israel", "israeli"]],
  ["IN", "IND", [], ["india", "indian"]],
  ["IT", "ITA", [], ["italy", "italian", "san marino", "sammarinese"]],
  ["JP", "JPN", [], ["japan", "japanese"]],
  ["KR", "KOR", [], ["korea", "south korea", "korean", "south korean"]],
  ["LI", "LIE", [], ["liechtenstein", "liechtensteiner"]],
  ["MA", "MAR", [], ["morocco", "moroccan"]],
  ["MC", "MCO", ["MON"], ["monaco", "monegasque", "monacan"]],
  ["MX", "MEX", [], ["mexico", "mexican"]],
  ["MY", "MYS", ["MAS"], ["malaysia", "malaysian"]],
  ["NL", "NLD", ["NED", "HOL"], ["netherlands", "the netherlands", "holland", "dutch"]],
  ["NZ", "NZL", [], ["new zealand", "new zealander"]],
  ["PL", "POL", [], ["poland", "polish"]],
  ["PT", "PRT", ["POR"], ["portugal", "portuguese"]],
  ["QA", "QAT", [], ["qatar", "qatari"]],
  ["RU", "RUS", [], ["russia", "russian", "russian federation"]],
  ["SA", "SAU", ["KSA"], ["saudi arabia", "saudi", "saudi arabian"]],
  ["SE", "SWE", [], ["sweden", "swedish"]],
  ["SG", "SGP", [], ["singapore", "singaporean"]],
  ["TH", "THA", [], ["thailand", "thai"]],
  ["TR", "TUR", [], ["turkey", "turkiye", "türkiye", "turkish"]],
  ["US", "USA", [], ["united states", "united states of america", "usa", "us", "america", "american"]],
  ["UY", "URY", ["URU"], ["uruguay", "uruguayan"]],
  ["VE", "VEN", [], ["venezuela", "venezuelan"]],
  ["VN", "VNM", [], ["vietnam", "vietnamese"]],
  ["ZA", "ZAF", ["RSA"], ["south africa", "south african"]],
];

/** States with no flag file: shown without a flag rather than with a wrong one. */
const NO_FLAG: [string[], string[]] = [
  ["DDR", "GDR", "RSR"],
  ["east german", "east germany", "rhodesian", "rhodesia"],
];

const BY_CODE: Record<string, string | null> = buildByCode();
const BY_NAME: Record<string, string | null> = buildByName();
const ISO2 = new Set(COUNTRIES.map(([iso2]) => iso2));

function buildByCode(): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const [iso2, iso3, others] of COUNTRIES) {
    map[iso3] = iso2;
    for (const code of others) map[code] = iso2;
  }
  for (const code of NO_FLAG[0]) map[code] = null;
  return map;
}

function buildByName(): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const [iso2, , , names] of COUNTRIES) {
    for (const name of names) map[name] = iso2;
  }
  for (const name of NO_FLAG[1]) map[name] = null;
  return map;
}
