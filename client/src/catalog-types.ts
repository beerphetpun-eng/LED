export type UserNotes = {
  bookmarked: boolean;
  stars: number;
  comment: string;
  auctionStatus: string;
  protected: boolean;
};
export type Parcel = {
  deed: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  evidenceUrl?: string;
  mapEvidenceUrl?: string;
  backgroundReady?: boolean;
  note?: string;
};
export type FacebookResult = {
  checkedAt: string;
  note: string;
  scannedPosts: number;
  warnings: string[];
  posts: {
    url: string;
    text: string;
    match: { date: string; auction: string; days: number; kind: string };
    images: { url: string; sourceUrl: string; photoId: string }[];
    rowMatched: boolean;
  }[];
};
export type Property = {
  id: string;
  componentKey?: string;
  address?: string;
  assetComponents?: Property[];
  propertyType: string;
  province: string;
  district: string;
  subdistrict: string;
  deed: string;
  assetSequence: string;
  caseNumber: string;
  plaintiff: string;
  saleLot: string;
  landDocument?: string;
  price: number | null;
  pricing: {
    appraisal: number | null;
    carriesMortgage: boolean;
    mortgageDebt: number | null;
    total: number | null;
    options: {
      discount: number;
      appraisal: number | null;
      total: number | null;
    }[];
    warning: string | null;
    mortgageClause: string | null;
  };
  areaSqWa: number | null;
  areaText: string;
  auctionDates: string[];
  screenshotUrl: string;
  evidenceReady?: boolean;
  evidenceImages?: { total: number; loaded: number; checkedAt: string };
  parcels: Parcel[];
  status: string;
  error?: string;
  user: UserNotes;
  firstSeen: string;
  lastSeen: string;
  syncCount: number;
  facebook?: FacebookResult;
};
export type Province = {
  code: string;
  name: string;
  districts: { code: string; name: string }[];
};
export type Settings = {
  enabled: boolean;
  intervalHours: number;
  scopes: { provinceCode: string; districtCodes: string[] }[];
  retention: string;
};
export type Runtime = {
  running: boolean;
  status: string;
  message: string;
  pages?: number;
  seen?: number;
  skippedRed?: number;
  skippedExisting?: number;
  nextRunAt?: string;
  geoRetryAt?: string | null;
  quotaMessage?: string;
  scopeIndex?: number;
  scopeCount?: number;
  geoDone?: number;
  geoTotal?: number;
};
export type SyncResponse = {
  settings: Settings;
  runtime: Runtime;
  alerts: SyncAlert[];
  lastCleanup?: { at: string; deleted: number };
};
export type SyncAlert = {
  id: string;
  message: string;
  createdAt: string;
  retryable: boolean;
  retryCount: number | null;
  checkedAt: string | null;
  recoveredAt: string | null;
};
export type Filters = Record<string, string>;
export type Library = {
  items: Property[];
  total: number;
  facets: {
    provinces: string[];
    districts: string[];
    types: string[];
    maxPrice: number;
    maxRai: number;
  };
};
