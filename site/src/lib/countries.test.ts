import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countryIso2, firstCountryIso2 } from "./countries";

const NATIONALITIES = ["American", "Argentine", "Australian", "Austrian", "Belgian", "Brazilian", "British", "Canadian", "Chilean", "Chinese", "Colombian", "Czech", "Danish", "Dutch", "Finnish", "French", "German", "Hong Kong", "Hungarian", "Indian", "Indonesian", "Irish", "Italian", "Japanese", "Liechtensteiner", "Malaysian", "Mexican", "Monegasque", "New Zealander", "Polish", "Portuguese", "Russian", "South African", "Spanish", "Swedish", "Swiss", "Thai", "Uruguayan", "Venezuelan"];
const COUNTRIES = ["Argentina", "Australia", "Austria", "Azerbaijan", "Bahrain", "Belgium", "Brazil", "Canada", "China", "France", "Germany", "Hungary", "India", "Italy", "Japan", "Korea", "Malaysia", "Mexico", "Monaco", "Morocco", "Netherlands", "Portugal", "Qatar", "Russia", "Saudi Arabia", "Singapore", "South Africa", "Spain", "Sweden", "Switzerland", "Turkey", "UAE", "UK", "USA", "United States"];

describe("countryIso2", () => {
  it("resolves nationalities, country names and codes", () => {
    expect(countryIso2("British")).toBe("GB");
    expect(countryIso2("UK")).toBe("GB");
    expect(countryIso2("GBR")).toBe("GB");
    expect(countryIso2("Monegasque")).toBe("MC");
    expect(countryIso2("MON")).toBe("MC");
    expect(countryIso2("DEN")).toBe("DK");
    expect(countryIso2("United States")).toBe("US");
    expect(countryIso2("nl")).toBe("NL");
  });

  it("gives no flag for historic states and unknown input", () => {
    expect(countryIso2("East German")).toBeNull();
    expect(countryIso2("RSR")).toBeNull();
    expect(countryIso2("Atlantis")).toBeNull();
    expect(countryIso2(null)).toBeNull();
  });

  it("falls through to the next source", () => {
    expect(firstCountryIso2("Atlantis", "ITA")).toBe("IT");
  });

  it("covers every nationality and country in the data, each with a flag file", () => {
    for (const value of [...NATIONALITIES, ...COUNTRIES]) {
      const iso2 = countryIso2(value);
      expect(iso2, value).not.toBeNull();
      const file = join(process.cwd(), "public", "flags", `${iso2?.toLowerCase()}.svg`);
      expect(existsSync(file), file).toBe(true);
    }
  });
});
