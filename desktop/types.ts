export type StepKind =
  | 'script'
  | 'aiFill'
  | 'inputWait'
  | 'aiScript'
  | 'loop'
  | 'patternValidate'
  | 'apiValidate';

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

export interface FlowNode {
  id: string;
  data?: {
    label?: string;
    scriptText?: string;
    description?: string;
    stepId?: number;
    stepKind?: StepKind;
    goal?: string;
    htmlCatalog?: Array<{
      id: string;
      tag: string;
      role: string;
      name: string;
      scope: string;
      htmlSize: number;
    }>;
    /** Sliced page markup used at AI-script generate time (not the full page). */
    htmlElements?: string;
    wait?: { kind?: 'otp' | 'captcha'; timeoutMs?: number };
    /** Loop times. Navigate-back JS is `scriptText` on this node. */
    loop?: { count?: number };
    pattern?: {
      field?: string;
      format?: string;
      invalidExample?: string;
      validExample?: string;
    };
    frontendValidator?: {
      mode?: 'autoFill' | 'captured';
      sourceAiFillNodeId?: string;
      triggerButton?: {
        label: string;
        locatorCandidates: string[];
        clickScriptLine?: string;
      };
      restoreFields?: AiFillField[];
      restoreAfterValidate?: boolean;
      fields?: Array<{
        field: AiFillField;
        rule: string;
        scriptMode?: 'ai' | 'manual';
        scriptText?: string;
        plan?: {
          fieldId: string;
          invalidValue: string;
          validValue: string;
          trigger: 'input' | 'blur' | 'submit';
          detection: 'error' | 'rejected' | 'native-invalid';
          errorText?: string;
          warningMessage?: string;
          scriptText?: string;
        };
      }>;
      plans?: Array<{
        fieldId: string;
        invalidValue: string;
        validValue: string;
        trigger: 'input' | 'blur' | 'submit';
        detection: 'error' | 'rejected' | 'native-invalid';
        errorText?: string;
        warningMessage?: string;
        scriptText?: string;
      }>;
    };
    api?: { urlContains?: string; method?: string; sampleJson?: string };
    apiValidate?: {
      capturedApis?: Array<{
        id: string;
        method: string;
        url: string;
        urlPattern: string;
        resourceType?: string;
        status: number;
        requestBody?: string;
        responseBody?: string;
        occurrence?: number;
      }>;
      apis?: Array<{
        api: {
          id: string;
          method: string;
          url: string;
          urlPattern: string;
          resourceType?: string;
          status: number;
          requestBody?: string;
          responseBody?: string;
          occurrence?: number;
        };
        alias: string;
        rule: string;
        scriptMode?: 'ai' | 'manual';
        scriptText?: string;
      }>;
    };
  };
}

export interface FlowEdge {
  source: string;
  target: string;
  /** React Flow handle id — use `out` / `repeat` on Loop sources. */
  sourceHandle?: string | null;
  targetHandle?: string | null;
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

export interface RunSnapshot {
  id: number;
  resultId: number;
  flowId: number;
  projectId: number;
  flowName?: string;
  projectName?: string;
  result: string;
  stepProgress: StepProgressItem[] | null;
  currentNodeId: string | null;
  failedStepId: number | null;
  errorMessage: string | null;
  /** Operator prompt while paused for human input (OTP/captcha). Not an error. */
  pauseMessage: string | null;
  commitId?: string | null;
}

export interface StartRunBody {
  resultId: number;
  flowId: number;
  projectId: number;
  projectUrl?: string;
  projectName?: string;
  flowName?: string;
  commitId?: string | null;
  /** Milliseconds to pause before each script line during Run (0–1000). */
  lineDelayMs?: number;
  /** When true, Playwright records a webm of the full run. */
  recordVideo?: boolean;
  /**
   * When set, capture before/after screenshots per step and attach them
   * to the given manual steps (auto manual generation).
   */
  manualCapture?: {
    manualId: number;
    /** Map canvas nodeId → manual_steps.id */
    stepMap: Record<string, number>;
  };
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface CaptureEvent {
  id: number;
  type: 'click' | 'fill' | 'press';
  scriptLine: string;
  detail: string;
  createdAt: string;
}

export interface StartCaptureBody {
  untilNodeId: string;
  url?: string;
  projectUrl?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}
