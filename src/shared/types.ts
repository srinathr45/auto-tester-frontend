export interface Project {
  id: number;
  name: string;
  description: string | null;
  url: string;
  organizationId: number | null;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface Flow {
  id: number;
  name: string;
  description: string | null;
  projectId: number;
  /** MinIO object key for the single flow repository JSON. */
  flowRepositoryObjectKey?: string | null;
  /** Graph from the selected branch head. */
  steps: FlowGraph;
  version?: FlowVersionState;
  localDraft?: {
    baseCommitId: string | null;
    updatedAt: string;
  };
}

export interface FlowCommit {
  id: string;
  flowId: number;
  parentIds: string[];
  branchName: string;
  authorUserId: number;
  message: string;
  contentHash: string;
  objectKey?: string;
  size?: number;
  contentType?: string;
  snapshot?: FlowGraph;
  createdAt: string;
}

export interface FlowBranch {
  id: number;
  flowId: number;
  name: string;
  headCommitId: string | null;
  forkedFromCommitId: string | null;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
}

export interface FlowVersionState {
  currentBranch: string;
  headCommitId: string | null;
  head: FlowCommit | null;
  branches: FlowBranch[];
}

export interface FlowRepository {
  formatVersion: 1;
  flowId: number;
  projectId: number;
  commits: Array<FlowCommit & { snapshot: FlowGraph }>;
}

export interface CommitConflict {
  nodeId: string;
  field: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
}

/** How a step is authored and executed. Missing kind is treated as 'script'. */
export type StepKind =
  | 'script'
  | 'aiFill'
  | 'inputWait'
  | 'aiScript'
  | 'loop'
  | 'patternValidate'
  | 'apiValidate';

export interface WaitConfig {
  kind?: 'otp' | 'captcha';
  timeoutMs?: number;
}

export interface LoopConfig {
  /** How many times to run the body (steps from Repeat-to → Loop). */
  count?: number;
}

export interface PatternConfig {
  field?: string;
  format?: string;
  invalidExample?: string;
  validExample?: string;
}

export type FrontendValidatorMode = 'autoFill' | 'captured';

export type FrontendValidatorScriptMode = 'ai' | 'manual';

export interface FrontendValidatorTriggerButton {
  label: string;
  locatorCandidates: string[];
  clickScriptLine?: string;
}

export interface FrontendValidatorField {
  field: AiFillField;
  rule: string;
  scriptMode?: FrontendValidatorScriptMode;
  scriptText?: string;
  plan?: FrontendValidationPlan;
}

export type FrontendValidationTrigger = 'input' | 'blur' | 'submit';
export type FrontendValidationDetection = 'error' | 'rejected' | 'native-invalid';

export interface FrontendValidationPlan {
  fieldId: string;
  invalidValue: string;
  validValue: string;
  trigger: FrontendValidationTrigger;
  detection: FrontendValidationDetection;
  errorText?: string;
  warningMessage?: string;
  scriptText?: string;
}

export interface FrontendValidatorConfig {
  mode?: FrontendValidatorMode;
  sourceAiFillNodeId?: string;
  triggerButton?: FrontendValidatorTriggerButton;
  /** Snapshot and restore these fields after validation (defaults to linked aiFill / validator fields). */
  restoreFields?: AiFillField[];
  /** When true (default), refill snapshotted values and URL after validation blocks. */
  restoreAfterValidate?: boolean;
  fields?: FrontendValidatorField[];
  /** @deprecated use fields[].plan */
  plans?: FrontendValidationPlan[];
}

/** @deprecated Legacy generate-script fields; inspector uses apiValidate. */
export interface ApiConfig {
  urlContains?: string;
  method?: string;
  sampleJson?: string;
}

export type ApiValidateScriptMode = 'ai' | 'manual';

/** One XHR/fetch call captured from the previous step. */
export interface CapturedApiCall {
  id: string;
  method: string;
  url: string;
  urlPattern: string;
  resourceType?: 'xhr' | 'fetch' | string;
  status: number;
  requestBody?: string;
  responseBody?: string;
  /** 1-based index among calls that share method + urlPattern. */
  occurrence?: number;
}

export interface ApiValidateItem {
  api: CapturedApiCall;
  /** Binding name in the combined script: api1, api2, … */
  alias: string;
  rule: string;
  scriptMode?: ApiValidateScriptMode;
  scriptText?: string;
}

export interface ApiValidateConfig {
  capturedApis?: CapturedApiCall[];
  apis?: ApiValidateItem[];
}

export type AiFillMode = 'local' | 'conditionalAi';

export type AiFillFieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio';

export interface AiFillOption {
  label: string;
  value: string;
}

/** DOM metadata captured during AI-fill authoring; locators stay app-owned. */
export interface AiFillField {
  fieldId: string;
  label: string;
  name?: string;
  type?: string;
  kind: AiFillFieldKind;
  required: boolean;
  visible: boolean;
  enabled: boolean;
  locatorCandidates: string[];
  options?: AiFillOption[];
  pattern?: string;
  group?: string;
}

export interface AiFillFieldSuggestion {
  fieldId?: string;
  label?: string;
  kind?: AiFillFieldKind;
  reason: string;
  searchText?: string;
}

export interface AiFillConditionalAction {
  fieldId: string;
  action: 'fill' | 'check' | 'select' | 'click';
  value?: string;
  assert?: 'visible' | 'enabled' | 'present';
}

export type HtmlLocateAction = 'click' | 'fill' | 'check' | 'assert';

/** Structured search hint for AI-script HTML slicing. Never a CSS selector. */
export interface HtmlLocateHint {
  action: HtmlLocateAction;
  tags: string[];
  roles: string[];
  namePattern: string;
  scopeHint?: string;
}

/** Compact interactive control listed during AI-script capture. */
export interface HtmlCatalogItem {
  id: string;
  tag: string;
  role: string;
  name: string;
  scope: string;
  htmlSize: number;
}

export interface StepData {
  label: string;
  description?: string;
  /** Playwright JS. On Loop this is the navigate-back script (runs before each repeat). */
  scriptText?: string;
  stepKind?: StepKind;
  /** Natural-language intent used by AI generate / fill. */
  goal?: string;
  /** Compact interactive index from AI-script capture (no markup). */
  htmlCatalog?: HtmlCatalogItem[];
  /** Sliced page markup used at AI-script generate time (not the full page). */
  htmlElements?: string;
  /** How this AI-fill step was authored. */
  aiFillMode?: AiFillMode;
  /** Fields selected and normalized during authoring. */
  aiFillFields?: AiFillField[];
  /** Field IDs the user explicitly selected for this step. */
  aiFillSelectedFieldIds?: string[];
  /** Conditional actions returned by AI and compiled into scriptText. */
  aiFillActions?: AiFillConditionalAction[];
  wait?: WaitConfig;
  loop?: LoopConfig;
  pattern?: PatternConfig;
  frontendValidator?: FrontendValidatorConfig;
  api?: ApiConfig;
  apiValidate?: ApiValidateConfig;
  [key: string]: unknown;
}

export interface FlowNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: StepData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** React Flow handle id — use `out` / `repeat` on Loop sources. */
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Lightweight step hit from project-wide search (derived from flow graphs). */
export interface Step {
  id?: number;
  name: string;
  description: string | null;
  flowId: number;
  nodeId?: string;
  data: Record<string, unknown> | null;
}

export type StepProgressStatus = 'pending' | 'running' | 'passed' | 'warned' | 'failed';

export interface StepProgressItem {
  nodeId: string;
  stepId?: number;
  name: string;
  status: StepProgressStatus;
  errorMessage?: string | null;
  screenshotArtifactId?: number | null;
}

/** Ephemeral run snapshot (Electron in-memory only — not stored in Nest). */
export interface Result {
  id: number;
  flowId: number;
  projectId: number;
  failedStepId: number | null;
  errorMessage: string | null;
  /** Operator prompt while paused for human input (OTP/captcha). Not an error. */
  pauseMessage?: string | null;
  result: string;
  stepProgress: StepProgressItem[] | null;
  currentNodeId: string | null;
  commitId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaletteItem {
  label: string;
  description: string;
  scriptSnippet: string;
}
