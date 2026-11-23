export type UserNotes = {
  bookmarked: boolean;
  stars: number;
  comment: string;
  auctionStatus: string;
  protected: boolean;
};
export type DetailAction = "photos" | "deeds";
export type Parcel = {
  deed: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  evidenceUrl?: string;
  mapEvidenceUrl?: string;
  backgroundReady?: boolean;
  note?: string;
  lookupWarning?: string;
};
export type CaseBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type FacebookResult = {
  checkedAt?: string;
  caseFilter?: {
    status:
      | "scanning"
      | "matched"
      | "no_match"
      | "incomplete"
      | "unreadable"
      | "no_case";
    checked: number;
    total: number;
    matched: number;
    unreadable: number;
    uncertainRows?: number;
    verified?: number;
    incomplete: number;
  };
  posts: {
    url: string;
    text: string;
    publishedOn: string;
    match: { date: string; auction: string; kind: "result" | "announcement" };
    images: {
      url: string;
      sourceUrl: string;
      photoId: string;
      caseBoxes?: CaseBox[];
    }[];
    expectedPhotos?: number | null;
    downloadedPhotos?: number;
  }[];
};
export type FacebookLibraryStatus = {
  running: boolean;
  checkedAt?: string;
  total: number;
  complete: number;
  partial: number;
  photos: number;
  warnings: string[];
  progress?: { message: string; targetDate: string | null } | null;
};
export type FacebookLibraryData = FacebookLibraryStatus & {
  groups: {
    date: string | null;
    properties: number;
    available: boolean;
    awaitingAnnouncement: boolean;
    checkedAt: string | null;
    posts: (Omit<FacebookResult["posts"][number], "match"> & {
      albumKey: string;
      kind: "result" | "announcement" | null;
      eligible: boolean;
      complete: boolean;
    })[];
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
  areaUnit?: "sqm" | "sqwa";
  areaText: string;
  auctionDates: string[];
  screenshotUrl: string;
  evidenceReady?: boolean;
  evidenceImages?: {
    total: number;
    loaded: number;
    checkedAt: string;
    photos?: { total: number; loaded: number };
    previousCaptureKept?: boolean;
  };
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
  duplicatePolicy?: "skip_unchanged" | "refresh_all";
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
  nextGeoRunAt?: string;
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
  facebookLibrary: FacebookLibraryStatus;
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
