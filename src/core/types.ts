/**
 * Physical Memory — core domain model.
 *
 * The physical world is modelled as a TEMPORAL KNOWLEDGE GRAPH:
 *
 *  - Entities are nodes: spaces, rooms, fixtures (furniture), containers and items.
 *    Any entity may hold other entities (a pouch is an item that is also a container).
 *  - Where something is, is never a field on the entity. It is DERIVED from an
 *    append-only log of Observations, each carrying time, source, evidence type,
 *    confidence and (optionally) media evidence.
 *  - Non-spatial facts (ownership, loans, part-of structure, "seen with") are
 *    Relations with validity intervals, so the graph can be queried "as of" any time.
 *
 * Nothing in this module depends on React Native, so it is fully unit-testable and
 * shared between the app, tests and (conceptually) the backend.
 */

export type ID = string;
/** ISO-8601 timestamp string. */
export type ISODate = string;

export type EntityKind = 'space' | 'room' | 'fixture' | 'container' | 'item';

export type SpaceType =
  | 'home'
  | 'office'
  | 'dorm'
  | 'family_home'
  | 'storage_unit'
  | 'garage'
  | 'lab'
  | 'workshop'
  | 'vehicle'
  | 'travel'
  | 'other';

/** Spatial relation between an entity and the entity that holds/supports it. */
export type PlacementRelation = 'INSIDE' | 'ON_TOP_OF' | 'UNDER' | 'NEXT_TO' | 'ATTACHED_TO' | 'LOCATED_IN';

/** Non-spatial / structural relations kept in the relations table. */
export type RelationType =
  | 'PART_OF'
  | 'BELONGS_TO'
  | 'LENT_TO'
  | 'LAST_SEEN_WITH'
  | 'SAME_AS_CANDIDATE'
  | 'NOT_SAME_AS';

export type SizeClass = 'tiny' | 'small' | 'medium' | 'large' | 'huge';

export interface VisualAttributes {
  colors: string[];
  brand?: string;
  model?: string;
  material?: string;
  shape?: string;
  sizeClass?: SizeClass;
  /** Scratches, stickers, engravings — the things that make *this* instance unique. */
  distinguishingMarks: string[];
}

export type Mobility = 'high' | 'medium' | 'low' | 'static';

export interface StorageBoxMeta {
  number: number;
  /** Stable code encoded in the QR label: pm://box/<code> */
  code: string;
  category?: string;
  sealedAt?: ISODate;
}

export interface Entity {
  id: ID;
  kind: EntityKind;
  /** Canonical, user-facing name ("Passport", "Top drawer", "Box 17"). */
  name: string;
  /** Free-form category ("documents", "electronics/charger"). */
  category?: string;
  /** Rich visual description produced by the vision model or the user. Indexed for search. */
  description?: string;
  attributes: VisualAttributes;
  aliases: string[];
  /** A pouch, backpack or suitcase is an item that can also hold things. */
  isContainer: boolean;
  spaceType?: SpaceType;
  ownerId?: ID;
  /** Sensitive objects (passport, meds, IDs): no OCR text retained, excluded from shared views by default. */
  sensitive: boolean;
  /** Private zones prohibit passive recognition and hide contents from shared members. */
  privateZone: boolean;
  mobility?: Mobility;
  box?: StorageBoxMeta;
  /** Representative evidence thumbnail. */
  coverMediaId?: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
  archivedAt?: ISODate;
}

export type ObservationSource =
  | 'camera_capture' // "Remember this"
  | 'area_scan' // Scan drawer / shelf / room
  | 'box_scan' // Storage box mode
  | 'qr_scan' // Scanned a box label at a location
  | 'voice_statement' // "I put the charger in the desk drawer"
  | 'manual' // Typed / tapped correction
  | 'setup' // Structure defined during space setup
  | 'passive' // V3 — consented background observation
  | 'tracker'; // V3 — BLE/UWB tracker integration

/** Observed = seen by a camera. UserStated = the user said so. Inferred = derived by the system. */
export type EvidenceKind = 'observed' | 'user_stated' | 'inferred';

/**
 * sighting  — the subject was seen/stated at a placement.
 * absence   — a scan of `placement.parentId` did NOT detect the subject. Not proof it is gone.
 * removal   — the user explicitly said the subject is no longer at its last location.
 */
export type ObservationType = 'sighting' | 'absence' | 'removal';

export type VerificationStatus = 'unverified' | 'confirmed' | 'corrected' | 'rejected';

export interface Placement {
  parentId: ID;
  relation: PlacementRelation;
}

export interface BoundingBox {
  /** Normalised 0..1 coordinates within the source frame. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Observation {
  id: ID;
  subjectId: ID;
  type: ObservationType;
  observedAt: ISODate;
  recordedAt: ISODate;
  source: ObservationSource;
  evidence: EvidenceKind;
  placement: Placement | null;
  /**
   * Ancestor chain (nearest first) as it was when the observation was made.
   * Preserved so history stays truthful even if furniture or boxes later move.
   */
  chainSnapshot: ID[];
  captureId?: ID;
  mediaId?: ID;
  bbox?: BoundingBox;
  /** Detector confidence that the thing seen is what it was labelled as. 0..1 */
  detectionConfidence: number;
  /** Confidence that the detection is THIS specific entity (instance re-identification). 0..1 */
  matchConfidence: number;
  detectedLabel?: string;
  verifiedLabel?: string;
  verification: VerificationStatus;
  /** Retracted observations are kept for audit but ignored by reasoning. */
  retracted: boolean;
  deviceId?: string;
  note?: string;
}

export interface Relation {
  id: ID;
  fromId: ID;
  type: RelationType;
  toId: ID;
  validFrom: ISODate;
  validTo?: ISODate;
  source: ObservationSource;
  confidence: number;
}

export type PersonRelationship = 'self' | 'partner' | 'roommate' | 'child' | 'parent' | 'family' | 'friend' | 'work' | 'other';

export interface Person {
  id: ID;
  name: string;
  relationship: PersonRelationship;
  createdAt: ISODate;
}

export interface Loan {
  id: ID;
  itemId: ID;
  personId: ID;
  lentAt: ISODate;
  expectedReturnAt?: ISODate;
  returnedAt?: ISODate;
  note?: string;
}

export type TripItemState = 'packed' | 'not_packed' | 'needs_confirmation' | 'arrived' | 'left_behind';

export interface Trip {
  id: ID;
  name: string;
  departsAt?: ISODate;
  returnsAt?: ISODate;
  /** The bag/suitcase entity items should be packed into. */
  bagIds: ID[];
  createdAt: ISODate;
  closedAt?: ISODate;
}

export interface TripItem {
  tripId: ID;
  itemId: ID;
  state: TripItemState;
  updatedAt: ISODate;
}

/** Every time the user fixes the AI, we record prediction vs. truth. Valuable learning signal. */
export interface Correction {
  id: ID;
  entityId?: ID;
  observationId?: ID;
  field: 'label' | 'category' | 'placement' | 'identity' | 'attributes' | 'room';
  aiValue: string;
  userValue: string;
  createdAt: ISODate;
}

export interface MediaAsset {
  id: ID;
  localUri: string;
  remotePath?: string;
  width: number;
  height: number;
  kind: 'frame' | 'crop';
  /** Crop assets reference the frame they were cut from (the frame may have been discarded for privacy). */
  parentMediaId?: ID;
  containsPeople: boolean;
  createdAt: ISODate;
}

export interface EntityEmbedding {
  entityId: ID;
  model: string;
  modality: 'text' | 'image';
  vector: number[];
  updatedAt: ISODate;
}

/** Complete in-memory view of a user's physical memory. */
export interface GraphData {
  entities: Entity[];
  observations: Observation[];
  relations: Relation[];
  people: Person[];
  loans: Loan[];
  trips: Trip[];
  tripItems: TripItem[];
  corrections: Correction[];
  media: MediaAsset[];
  embeddings: EntityEmbedding[];
}

export const emptyGraph = (): GraphData => ({
  entities: [],
  observations: [],
  relations: [],
  people: [],
  loans: [],
  trips: [],
  tripItems: [],
  corrections: [],
  media: [],
  embeddings: [],
});
