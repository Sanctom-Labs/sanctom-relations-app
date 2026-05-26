// =============================================================================
// Relations v0.2 — pro-profile/types.ts unit tests
// =============================================================================
// Pure Zod schema validation. No DB or network calls — zero mocks needed.
// Coverage targets:
//   • CoachFieldsSchema / AttorneyFieldsSchema / PlumberFieldsSchema
//   • CreateProProfileSchema / UpdateProProfileSchema
//   • StageUpdateSchema / ProProfileListParamsSchema
//   • PRO_TYPE_DEFAULTS structure sanity
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  CoachFieldsSchema,
  AttorneyFieldsSchema,
  PlumberFieldsSchema,
  StubFieldsSchema,
  CreateProProfileSchema,
  UpdateProProfileSchema,
  StageUpdateSchema,
  ProProfileListParamsSchema,
  PRO_TYPE_DEFAULTS,
  PRO_TYPE_FIELD_SCHEMAS,
} from "./types.js";

// ---------------------------------------------------------------------------
// CoachFieldsSchema
// ---------------------------------------------------------------------------

describe("CoachFieldsSchema", () => {
  it("accepts empty object (all optional)", () => {
    const result = CoachFieldsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid coach fields", () => {
    const result = CoachFieldsSchema.safeParse({
      hourly_rate_usd:   150,
      cert_org:          "ICF",
      cert_id:           "ICF-12345",
      cert_expiry:       "2026-12-31",
      coaching_modality: "1:1",
      ica_member:        true,
      icf_credential:    "PCC",
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative hourly_rate_usd", () => {
    const result = CoachFieldsSchema.safeParse({ hourly_rate_usd: -50 });
    expect(result.success).toBe(false);
  });

  it("rejects zero hourly_rate_usd (must be positive)", () => {
    const result = CoachFieldsSchema.safeParse({ hourly_rate_usd: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid cert_expiry format (not ISO date)", () => {
    const result = CoachFieldsSchema.safeParse({ cert_expiry: "December 31 2026" });
    expect(result.success).toBe(false);
  });

  it("accepts valid ISO cert_expiry", () => {
    const result = CoachFieldsSchema.safeParse({ cert_expiry: "2027-01-01" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid icf_credential", () => {
    const result = CoachFieldsSchema.safeParse({ icf_credential: "MCCC" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid icf_credential values", () => {
    for (const cred of ["ACC", "PCC", "MCC"] as const) {
      expect(CoachFieldsSchema.safeParse({ icf_credential: cred }).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AttorneyFieldsSchema
// ---------------------------------------------------------------------------

describe("AttorneyFieldsSchema", () => {
  it("accepts empty object", () => {
    expect(AttorneyFieldsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid attorney fields", () => {
    const result = AttorneyFieldsSchema.safeParse({
      bar_number:         "12345",
      bar_state:          "NY",
      bar_expiry:         "2027-06-30",
      practice_areas:     ["family law", "estate planning"],
      case_capacity:      10,
      insurance_provider: "ALPS",
      retainer_usd:       5000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive case_capacity", () => {
    expect(AttorneyFieldsSchema.safeParse({ case_capacity: 0 }).success).toBe(false);
    expect(AttorneyFieldsSchema.safeParse({ case_capacity: -1 }).success).toBe(false);
  });

  it("rejects more than 20 practice_areas", () => {
    const areas = Array.from({ length: 21 }, (_, i) => `area ${i}`);
    const result = AttorneyFieldsSchema.safeParse({ practice_areas: areas });
    expect(result.success).toBe(false);
  });

  it("rejects invalid bar_expiry format", () => {
    const result = AttorneyFieldsSchema.safeParse({ bar_expiry: "2027/06/30" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PlumberFieldsSchema
// ---------------------------------------------------------------------------

describe("PlumberFieldsSchema", () => {
  it("accepts empty object", () => {
    expect(PlumberFieldsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid plumber fields", () => {
    const result = PlumberFieldsSchema.safeParse({
      license_number:     "P-98765",
      license_state:      "CA",
      license_expiry:     "2028-03-15",
      service_area_zip:   ["90001", "90002"],
      hourly_rate_usd:    120,
      job_min_usd:        250,
      insurance_provider: "Contractor Shield",
      bonded:             true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 50 service_area_zips", () => {
    const zips = Array.from({ length: 51 }, (_, i) => `9${String(i).padStart(4, "0")}`);
    const result = PlumberFieldsSchema.safeParse({ service_area_zip: zips });
    expect(result.success).toBe(false);
  });

  it("rejects negative job_min_usd", () => {
    expect(PlumberFieldsSchema.safeParse({ job_min_usd: -100 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StubFieldsSchema
// ---------------------------------------------------------------------------

describe("StubFieldsSchema", () => {
  it("accepts any object (open record)", () => {
    expect(StubFieldsSchema.safeParse({ anything: true, nested: { x: 1 } }).success).toBe(true);
    expect(StubFieldsSchema.safeParse({}).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CreateProProfileSchema
// ---------------------------------------------------------------------------

const VALID_CREATE_BODY = {
  person_id:            "00000000-0000-0000-0000-000000000001",
  owner_entity_id:      "00000000-0000-0000-0000-000000000002",
  pro_type:             "coach",
  pro_category:         "healing_arts",
  billing_model:        "session_based",
  engagement_structure: "recurring_sessions",
  regulatory_tier:      "cert_based",
} as const;

describe("CreateProProfileSchema", () => {
  it("accepts minimal valid body (required fields only)", () => {
    const result = CreateProProfileSchema.safeParse(VALID_CREATE_BODY);
    expect(result.success).toBe(true);
  });

  it("applies default values (availability_open=true, current_stage=prospect)", () => {
    const result = CreateProProfileSchema.safeParse(VALID_CREATE_BODY);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.availability_open).toBe(true);
      expect(result.data.current_stage).toBe("prospect");
      expect(result.data.specialties).toEqual([]);
      expect(result.data.languages).toEqual([]);
      expect(result.data.useful_links).toEqual([]);
    }
  });

  it("rejects invalid person_id (not UUID)", () => {
    const result = CreateProProfileSchema.safeParse({
      ...VALID_CREATE_BODY,
      person_id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown pro_type", () => {
    const result = CreateProProfileSchema.safeParse({
      ...VALID_CREATE_BODY,
      pro_type: "wizard",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown pro_category", () => {
    const result = CreateProProfileSchema.safeParse({
      ...VALID_CREATE_BODY,
      pro_category: "magic",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown billing_model", () => {
    const result = CreateProProfileSchema.safeParse({
      ...VALID_CREATE_BODY,
      billing_model: "pay_me_later",
    });
    expect(result.success).toBe(false);
  });

  it("rejects years_of_experience > 80", () => {
    const result = CreateProProfileSchema.safeParse({
      ...VALID_CREATE_BODY,
      years_of_experience: 81,
    });
    expect(result.success).toBe(false);
  });

  it("accepts years_of_experience = 0", () => {
    const result = CreateProProfileSchema.safeParse({
      ...VALID_CREATE_BODY,
      years_of_experience: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects specialties array longer than 30 items", () => {
    const result = CreateProProfileSchema.safeParse({
      ...VALID_CREATE_BODY,
      specialties: Array.from({ length: 31 }, (_, i) => `spec ${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("rejects useful_links with invalid URL", () => {
    const result = CreateProProfileSchema.safeParse({
      ...VALID_CREATE_BODY,
      useful_links: [{ label: "Website", url: "not-a-url" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts useful_links with valid URL", () => {
    const result = CreateProProfileSchema.safeParse({
      ...VALID_CREATE_BODY,
      useful_links: [{ label: "Website", url: "https://example.com" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts all valid pro_types", () => {
    const types = [
      "coach","therapist","mentor","trainer","tutor","healer","practitioner",
      "attorney","accountant","financial_advisor","consultant",
      "plumber","electrician","contractor","handyman","other",
    ] as const;
    for (const pt of types) {
      const result = CreateProProfileSchema.safeParse({ ...VALID_CREATE_BODY, pro_type: pt });
      expect(result.success, `expected ${pt} to be valid`).toBe(true);
    }
  });

  it("accepts all valid current_stage values", () => {
    const stages = ["prospect","contacted","screened","onboarded","active","churn","reactivation"] as const;
    for (const s of stages) {
      const result = CreateProProfileSchema.safeParse({ ...VALID_CREATE_BODY, current_stage: s });
      expect(result.success, `expected stage '${s}' to be valid`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// UpdateProProfileSchema
// ---------------------------------------------------------------------------

describe("UpdateProProfileSchema", () => {
  it("accepts empty body (all optional for PATCH)", () => {
    const result = UpdateProProfileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial update with only pro_type", () => {
    const result = UpdateProProfileSchema.safeParse({ pro_type: "attorney" });
    expect(result.success).toBe(true);
  });

  it("rejects person_id and owner_entity_id (omitted from update schema)", () => {
    // These fields are omitted() from the update schema — Zod strips them silently.
    // Verify by checking that the parsed output has no person_id.
    const result = UpdateProProfileSchema.safeParse({
      pro_type:   "coach",
      person_id:  "00000000-0000-0000-0000-000000000001",
    });
    // Zod strips unknown keys (strip mode) — it doesn't reject them; it just excludes them.
    // So we verify person_id is NOT in parsed output.
    if (result.success) {
      expect("person_id" in result.data).toBe(false);
    }
  });

  it("rejects invalid current_stage value", () => {
    const result = UpdateProProfileSchema.safeParse({ current_stage: "ghost" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StageUpdateSchema
// ---------------------------------------------------------------------------

describe("StageUpdateSchema", () => {
  it("accepts all valid stages", () => {
    const stages = ["prospect","contacted","screened","onboarded","active","churn","reactivation"] as const;
    for (const stage of stages) {
      expect(StageUpdateSchema.safeParse({ stage }).success, `stage '${stage}'`).toBe(true);
    }
  });

  it("rejects invalid stage", () => {
    expect(StageUpdateSchema.safeParse({ stage: "archived" }).success).toBe(false);
  });

  it("rejects missing stage field", () => {
    expect(StageUpdateSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProProfileListParamsSchema
// ---------------------------------------------------------------------------

describe("ProProfileListParamsSchema", () => {
  it("applies defaults for empty params", () => {
    const result = ProProfileListParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.page_size).toBe(50);
      expect(result.data.sort_by).toBe("created_at");
      expect(result.data.sort_dir).toBe("desc");
    }
  });

  it("coerces page and page_size from strings", () => {
    const result = ProProfileListParamsSchema.safeParse({ page: "3", page_size: "25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.page_size).toBe(25);
    }
  });

  it("rejects page_size > 200", () => {
    expect(ProProfileListParamsSchema.safeParse({ page_size: "201" }).success).toBe(false);
  });

  it("rejects page < 1", () => {
    expect(ProProfileListParamsSchema.safeParse({ page: "0" }).success).toBe(false);
  });

  it("accepts optional filters", () => {
    const result = ProProfileListParamsSchema.safeParse({
      pro_type: "coach",
      pro_category: "healing_arts",
      current_stage: "active",
      availability_open: "true",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.availability_open).toBe("true");
    }
  });

  it("rejects invalid availability_open value", () => {
    expect(ProProfileListParamsSchema.safeParse({ availability_open: "yes" }).success).toBe(false);
  });

  it("accepts sort_by values", () => {
    for (const sortBy of ["created_at", "updated_at", "current_stage"] as const) {
      expect(ProProfileListParamsSchema.safeParse({ sort_by: sortBy }).success).toBe(true);
    }
  });

  it("rejects invalid sort_by", () => {
    expect(ProProfileListParamsSchema.safeParse({ sort_by: "name" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PRO_TYPE_DEFAULTS — structural sanity
// ---------------------------------------------------------------------------

describe("PRO_TYPE_DEFAULTS", () => {
  const ALL_PRO_TYPES = [
    "coach","therapist","mentor","trainer","tutor","healer","practitioner",
    "attorney","accountant","financial_advisor","consultant",
    "plumber","electrician","contractor","handyman","other",
  ] as const;

  it("has an entry for every pro_type", () => {
    for (const pt of ALL_PRO_TYPES) {
      expect(PRO_TYPE_DEFAULTS[pt], `missing defaults for ${pt}`).toBeDefined();
    }
  });

  it("every entry has all four required fields", () => {
    for (const [type, defaults] of Object.entries(PRO_TYPE_DEFAULTS)) {
      expect(defaults.pro_category,         `${type}.pro_category`).toBeTruthy();
      expect(defaults.billing_model,        `${type}.billing_model`).toBeTruthy();
      expect(defaults.engagement_structure, `${type}.engagement_structure`).toBeTruthy();
      expect(defaults.regulatory_tier,      `${type}.regulatory_tier`).toBeTruthy();
    }
  });

  it("coach defaults are healing_arts / session_based / recurring_sessions / cert_based", () => {
    expect(PRO_TYPE_DEFAULTS.coach).toEqual({
      pro_category:         "healing_arts",
      billing_model:        "session_based",
      engagement_structure: "recurring_sessions",
      regulatory_tier:      "cert_based",
    });
  });

  it("attorney defaults are professional_services / billable_hours / case_based / state_license", () => {
    expect(PRO_TYPE_DEFAULTS.attorney).toEqual({
      pro_category:         "professional_services",
      billing_model:        "billable_hours",
      engagement_structure: "case_based",
      regulatory_tier:      "state_license",
    });
  });
});

// ---------------------------------------------------------------------------
// PRO_TYPE_FIELD_SCHEMAS — schema registry completeness
// ---------------------------------------------------------------------------

describe("PRO_TYPE_FIELD_SCHEMAS", () => {
  it("has a schema for every pro_type", () => {
    const types = [
      "coach","therapist","mentor","trainer","tutor","healer","practitioner",
      "attorney","accountant","financial_advisor","consultant",
      "plumber","electrician","contractor","handyman","other",
    ];
    for (const t of types) {
      expect(PRO_TYPE_FIELD_SCHEMAS[t as keyof typeof PRO_TYPE_FIELD_SCHEMAS]).toBeDefined();
    }
  });
});
