import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Cpu,
  FileText,
  Forward,
  Gauge,
  History,
  Image as ImageIcon,
  KeyRound,
  Lock,
  MessageSquarePlus,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plug,
  Plus,
  Reply,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type {
  HermesAccountUsageResponse,
  HermesChatMessage,
  HermesConnectionRequest,
  HermesErrorSurface,
  HermesFallbackProvider,
  HermesPendingApproval,
  HermesProfile,
  HermesServerRequest,
  HermesSessionSummary,
  HermesUsageLimitError,
} from "../../shared/types";
import { evaluateApprovalPolicy, loadAutoApproveSafe } from "../lib/approvalPolicy";
import {
  BOT_CHAT_TITLE,
  getBotHandle,
  pickPreferredBotSession,
} from "../lib/botCollaboration";
import { getBotVisual } from "../lib/botTheme";
import { loadBotDraft, saveBotDraft } from "../lib/draftStore";
import { formatBadgeCount } from "../lib/unreadStore";
import {
  formatChatDividerTime,
  formatRelativeTime,
  randomClientId,
  toTimestampMs,
} from "../lib/format";
import {
  deleteSession,
  fetchModelOptions,
  fetchProfileFallback,
  fetchServerUiPreferences,
  fetchSessionMessages,
  fetchSessions,
  normalizeMessages,
  prepareChatImageDataUrl,
  renameSession,
  transcribeAudioBlob,
  updateProfileModel,
  updateServerUiPreferences,
  uploadChatFile,
  type QuickPromptItem,
} from "../lib/hermesApi";
import { hermesWs, type WsConnectionState } from "../lib/hermesWs";
import { PRIVATE_CHAT_TITLE } from "../lib/privateVault";
import { notifyIfBackgrounded } from "../lib/pushClient";
import {
  detectBotSecretForm,
  detectBotVaultRequest,
  extractChecklists,
  extractPackageCards,
  extractPocketPages,
  extractProductDeals,
  stripSecretRequestTag,
  type DetectedDealCard,
  type DetectedPocketPage,
  type DetectedSecretRequest,
  type DetectedVaultRequest,
} from "../lib/secretDetection";
import {
  EMPTY_CHAT_USAGE,
  formatCompactWindowLabel,
  getPrimaryLimitSummary,
  mergeAccountUsage,
  mergeUsagePayload,
  RECOMMENDED_ANTHROPIC_FALLBACK,
  type ChatUsageState,
} from "../lib/usageLimits";
import { BotAvatar } from "./BotAvatar";
import { BotMediaGallerySheet } from "./BotMediaGallerySheet";
import { ConfirmSheet } from "./ConfirmSheet";
import { InChatConnectionCard } from "./InChatConnectionCard";
import { InteractiveChecklistCard } from "./InteractiveChecklistCard";
import { PackageTrackingCard } from "./PackageTrackingCard";
import {
  ApprovalPromptCard,
  ClarifyPromptCard,
  ManualSecretCard,
  PocketPageCard,
  PocketPageViewer,
  ProductDealCard,
  SECRET_REQUEST_METHODS,
  SecretPromptCard,
  UsageLimitCard,
  VaultFormCard,
} from "./InChatPromptCards";
import { SafeMarkdown } from "./SafeMarkdown";
import { Sheet } from "./Sheet";

const LimitSheet = lazy(() =>
  import("./LimitSheet").then((m) => ({ default: m.LimitSheet }))
);
const ModelPickerSheet = lazy(() =>
  import("./ModelPickerSheet").then((m) => ({ default: m.ModelPickerSheet }))
);

// ── Direct 1:1 Bot Chat Screen ────────────────────────────────────────────────

export interface DirectChatViewProps {
  profile: HermesProfile;
  allProfiles: HermesProfile[];
  isPrivateBot?: boolean;
  hideBackButton?: boolean;
  draftPrefill?: { botName: string; text: string; id: number } | null;
  onConsumeDraftPrefill?: () => void;
  onForwardToBot?: (targetBotName: string, text: string) => void;
  initialSessionId?: string | null;
  initialSessionTitle?: string | null;
  avatarUrl: string | null;
  otherUnreadCount?: number;
  wsState: WsConnectionState;
  onBack: () => void;
  onMarkBotRead?: (
    profileName: string,
    info?: {
      sessionId?: string | null;
      lastActiveMs?: number;
      messageCount?: number;
      messages?: HermesChatMessage[];
    }
  ) => void;
  onRegisterSession?: (profileName: string, sessionId: string | null) => void;
  onOpenBotSettings: () => void;
  onOpenConnectors?: () => void;
  onRefreshProfiles: () => Promise<void> | void;
}

interface QueuedAttachment {
  id: string;
  file: File;
  isImage: boolean;
  previewUrl?: string;
}

export const DirectChatView: React.FC<DirectChatViewProps> = ({
  profile,
  allProfiles,
  isPrivateBot = false,
  hideBackButton = false,
  draftPrefill = null,
  onConsumeDraftPrefill,
  onForwardToBot,
  initialSessionId = null,
  initialSessionTitle = null,
  avatarUrl,
  otherUnreadCount = 0,
  wsState,
  onBack,
  onMarkBotRead,
  onRegisterSession,
  onOpenBotSettings,
  onOpenConnectors,
  onRefreshProfiles,
}) => {
  const visual = getBotVisual(profile);
  const allProfileNames = useMemo(() => allProfiles.map((p) => p.name), [allProfiles]);
  const canonicalTitle = isPrivateBot ? PRIVATE_CHAT_TITLE : BOT_CHAT_TITLE;
  const [showAvatarLightbox, setShowAvatarLightbox] = useState(false);

  const [sessions, setSessions] = useState<HermesSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string>("Neuer Chat");
  const [messages, setMessages] = useState<HermesChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);

  const [input, setInput] = useState(() => loadBotDraft(profile.name));
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setInput(loadBotDraft(profile.name));
    setReplyTo(null);
  }, [profile.name]);

  useEffect(() => {
    saveBotDraft(profile.name, input);
  }, [profile.name, input]);
  const [attachments, setAttachments] = useState<QueuedAttachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<HermesPendingApproval | null>(null);
  const [pendingConnection, setPendingConnection] = useState<HermesConnectionRequest | null>(null);
  const [pendingClarify, setPendingClarify] = useState<HermesServerRequest | null>(null);
  const [pendingSecret, setPendingSecret] = useState<HermesServerRequest | null>(null);
  const [pendingVaultForm, setPendingVaultForm] = useState<DetectedVaultRequest | null>(null);
  const [manualSecret, setManualSecret] = useState<{
    open: boolean;
    formTitle?: string;
    initialKey: string;
    promptText?: string;
    fields?: DetectedSecretRequest[];
  }>({
    open: false,
    initialKey: "",
  });

  // Live Chat & Plan Limit + Automatic Fallback state
  const [usage, setUsage] = useState<ChatUsageState>(EMPTY_CHAT_USAGE);
  const [loadingAccountUsage, setLoadingAccountUsage] = useState(false);
  const [fallbacks, setFallbacks] = useState<HermesFallbackProvider[]>([]);
  const [usageLimitError, setUsageLimitError] = useState<HermesUsageLimitError | null>(null);
  const [switchingFallback, setSwitchingFallback] = useState(false);
  const [showLimitSheet, setShowLimitSheet] = useState(false);

  const [activeModelOverride, setActiveModelOverride] = useState<{
    provider: string;
    model: string;
  } | null>(null);
  const [modelPickerState, setModelPickerState] = useState<{
    open: boolean;
    search: string;
    provider: string;
  }>({ open: false, search: "", provider: "" });

  const [showSessionsSheet, setShowSessionsSheet] = useState(false);
  const [showActionsSheet, setShowActionsSheet] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<HermesSessionSummary | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const [openPocketPage, setOpenPocketPage] = useState<DetectedPocketPage | null>(null);
  const [copiedMsgKey, setCopiedMsgKey] = useState<string | null>(null);
  const [forwardText, setForwardText] = useState<string | null>(null);
  const isStreamingRef = useRef<boolean>(false);
  isStreamingRef.current = isStreaming;

  // Apply forwarded draft prefill when navigating from another bot
  useEffect(() => {
    if (!draftPrefill || draftPrefill.botName !== profile.name) return;
    setInput(draftPrefill.text);
    onConsumeDraftPrefill?.();
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        autoResizeInput(textareaRef.current);
      }
    });
  }, [draftPrefill, onConsumeDraftPrefill, profile.name]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const attachedOnWsRef = useRef<boolean>(false);
  const execGenerationRef = useRef<number>(0);
  const scrollTimersRef = useRef<number[]>([]);
  const isNearBottomRef = useRef<boolean>(true);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [replyTo, setReplyTo] = useState<{ author: string; excerpt: string } | null>(null);
  const [contextMsg, setContextMsg] = useState<{
    author: string;
    text: string;
    role: string;
  } | null>(null);

  const stopActiveDictation = useCallback(() => {
    try {
      if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
        mediaRecRef.current.onstop = null;
        mediaRecRef.current.stop();
        mediaRecRef.current.stream.getTracks().forEach((t) => t.stop());
      }
    } catch {
      // ignore
    }
    mediaRecRef.current = null;
    setVoiceActive("idle");
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const startLongPress = useCallback(
    (e: React.TouchEvent, author: string, text: string, role: string) => {
      if (e.touches.length !== 1 || !text.trim()) return;
      cancelLongPress();
      const t = e.touches[0];
      longPressStartRef.current = { x: t.clientX, y: t.clientY };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        longPressStartRef.current = null;
        try {
          navigator.vibrate?.(12);
        } catch {
          // ignore
        }
        setContextMsg({ author, text, role });
      }, 420);
    },
    [cancelLongPress]
  );

  const moveLongPress = useCallback(
    (e: React.TouchEvent) => {
      const start = longPressStartRef.current;
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10) {
        cancelLongPress();
      }
    },
    [cancelLongPress]
  );
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [inChatSearchOpen, setInChatSearchOpen] = useState(false);
  const [inChatSearchQuery, setInChatSearchQuery] = useState("");
  const [activeMatchPos, setActiveMatchPos] = useState(0);
  const [voiceActive, setVoiceActive] = useState<"idle" | "recording" | "transcribing">("idle");
  const [allQuickPrompts, setAllQuickPrompts] = useState<Record<string, QuickPromptItem[]>>({});
  const [showQuickPromptEditor, setShowQuickPromptEditor] = useState(false);
  const [newQuickLabel, setNewQuickLabel] = useState("");
  const [newQuickPrompt, setNewQuickPrompt] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchServerUiPreferences()
      .then((prefs) => {
        if (!cancelled) setAllQuickPrompts(prefs.quickPrompts || {});
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [profile.name]);

  const botQuickPrompts = allQuickPrompts[profile.name] || [];

  const handleSaveQuickPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = newQuickLabel.trim();
    const prompt = newQuickPrompt.trim();
    if (!label || !prompt) return;
    const nextList = [...botQuickPrompts, { label, prompt }].slice(0, 8);
    const nextMap = { ...allQuickPrompts, [profile.name]: nextList };
    setAllQuickPrompts(nextMap);
    setNewQuickLabel("");
    setNewQuickPrompt("");
    setShowQuickPromptEditor(false);
    void updateServerUiPreferences({ quickPrompts: nextMap }).catch(() => null);
  };

  const handleRemoveQuickPrompt = (idx: number) => {
    const nextList = botQuickPrompts.filter((_, i) => i !== idx);
    const nextMap = { ...allQuickPrompts, [profile.name]: nextList };
    if (nextList.length === 0) delete nextMap[profile.name];
    setAllQuickPrompts(nextMap);
    void updateServerUiPreferences({ quickPrompts: nextMap }).catch(() => null);
  };

  const inChatMatchIndices = useMemo(() => {
    const q = inChatSearchQuery.trim().toLowerCase();
    if (!inChatSearchOpen || !q) return [];
    const matches: number[] = [];
    messages.forEach((m, idx) => {
      if (m.content && m.content.toLowerCase().includes(q)) {
        matches.push(idx);
      }
    });
    return matches;
  }, [inChatSearchOpen, inChatSearchQuery, messages]);

  const activeMatchMsgIndex =
    inChatMatchIndices.length > 0
      ? inChatMatchIndices[Math.min(activeMatchPos, inChatMatchIndices.length - 1)]
      : -1;

  const jumpToSearchMatch = useCallback(
    (pos: number, list: number[]) => {
      if (list.length === 0) return;
      const wrapped = ((pos % list.length) + list.length) % list.length;
      setActiveMatchPos(wrapped);
      const targetIdx = list[wrapped];
      requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector(`[data-msg-idx="${targetIdx}"]`);
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    },
    []
  );

  useEffect(() => {
    if (inChatMatchIndices.length > 0) {
      jumpToSearchMatch(inChatMatchIndices.length - 1, inChatMatchIndices);
    } else {
      setActiveMatchPos(0);
    }
  }, [inChatSearchQuery, inChatMatchIndices.length, jumpToSearchMatch]);

  useEffect(() => {
    return () => {
      try {
        if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
          mediaRecRef.current.onstop = null;
          mediaRecRef.current.stop();
          mediaRecRef.current.stream.getTracks().forEach((t) => t.stop());
        }
      } catch {
        // ignore
      }
      mediaRecRef.current = null;
    };
  }, [profile.name]);

  const handleToggleVoice = useCallback(async () => {
    if (voiceActive === "transcribing") return;

    if (voiceActive === "recording") {
      try {
        mediaRecRef.current?.stop();
      } catch {
        setVoiceActive("idle");
      }
      return;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setChatError("Audio-Aufnahme wird in diesem Browser leider nicht unterstützt.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaRecRef.current = null;
        const blob = new Blob(audioChunksRef.current, { type: rec.mimeType || "audio/mp4" });
        if (blob.size < 200) {
          setVoiceActive("idle");
          return;
        }
        setVoiceActive("transcribing");
        void transcribeAudioBlob(blob, profile.name)
          .then(({ transcript }) => {
            if (transcript) {
              setInput((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
              requestAnimationFrame(() => {
                if (textareaRef.current) autoResizeInput(textareaRef.current);
              });
            }
          })
          .catch((err) => {
            setChatError(
              err instanceof Error
                ? err.message
                : "Spracherkennung fehlgeschlagen."
            );
          })
          .finally(() => setVoiceActive("idle"));
      };
      mediaRecRef.current = rec;
      setVoiceActive("recording");
      rec.start(250);
    } catch {
      setChatError("Mikrofonzugriff wurde nicht erlaubt.");
      setVoiceActive("idle");
    }
  }, [profile.name, voiceActive]);

  activeSessionRef.current = activeSessionId;

  const handleMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom < 140;
    isNearBottomRef.current = near;
    if (near) {
      setHasNewBelow(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        isNearBottomRef.current = true;
        setHasNewBelow(false);
      }
    });
  }, []);

  const scrollIfNearBottom = useCallback(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    } else {
      setHasNewBelow(true);
    }
  }, [scrollToBottom]);

  // Auto-sync missed messages when returning from standby / screen lock or regaining network
  useEffect(() => {
    const syncAfterResume = () => {
      if (document.visibilityState !== "visible") return;
      if (hermesWs.getState() === "disconnected") {
        hermesWs.connect();
      }
      const sid = activeSessionRef.current;
      if (!sid || isStreamingRef.current) return;
      void fetchSessionMessages(sid, profile.name)
        .then((fresh) => {
          if (fresh.length === 0) return;
          setMessages((prev) => {
            if (
              prev.length === fresh.length &&
              prev[prev.length - 1]?.content === fresh[fresh.length - 1]?.content
            ) {
              return prev;
            }
            return fresh;
          });
          onMarkBotRead?.(profile.name, { sessionId: sid, messages: fresh });
          scrollIfNearBottom();
        })
        .catch(() => {
          // Best-effort background resync
        });
    };
    document.addEventListener("visibilitychange", syncAfterResume);
    window.addEventListener("online", syncAfterResume);
    return () => {
      document.removeEventListener("visibilitychange", syncAfterResume);
      window.removeEventListener("online", syncAfterResume);
    };
  }, [onMarkBotRead, profile.name, scrollIfNearBottom]);

  const scrollToBottomWithSettle = useCallback(() => {
    for (const id of scrollTimersRef.current) window.clearTimeout(id);
    scrollTimersRef.current = [];
    scrollToBottom();
    for (const delay of [60, 180, 340]) {
      scrollTimersRef.current.push(window.setTimeout(scrollToBottom, delay));
    }
  }, [scrollToBottom]);

  // Always jump to latest message when mobile keyboard opens
  useEffect(() => {
    const onViewportChange = (ev: Event) => {
      const detail = (ev as CustomEvent<{ keyboardOpen?: boolean }>).detail;
      if (detail?.keyboardOpen) {
        scrollToBottomWithSettle();
      }
    };
    window.addEventListener("hp:viewport-change", onViewportChange);
    return () => {
      window.removeEventListener("hp:viewport-change", onViewportChange);
      for (const id of scrollTimersRef.current) window.clearTimeout(id);
      scrollTimersRef.current = [];
    };
  }, [scrollToBottomWithSettle]);

  const refreshAccountUsage = useCallback(
    async (sidOverride?: string | null) => {
      if (wsState !== "connected") return;
      const targetSid = sidOverride ?? activeSessionRef.current;
      setLoadingAccountUsage(true);
      try {
        const res = await hermesWs.call<HermesAccountUsageResponse>(
          "session.account_usage",
          {
            ...(targetSid ? { session_id: targetSid } : {}),
            profile: profile.name,
          },
          12_000
        );
        setUsage((prev) => mergeAccountUsage(prev, res));
      } catch {
        // Optional depending on active provider
      } finally {
        setLoadingAccountUsage(false);
      }
    },
    [profile.name, wsState]
  );

  // Load configured automatic fallback chain for this bot
  useEffect(() => {
    let cancelled = false;
    setUsage(EMPTY_CHAT_USAGE);
    setUsageLimitError(null);
    setActiveModelOverride(null);
    void fetchProfileFallback(profile.name)
      .then((list) => {
        if (!cancelled) setFallbacks(list);
      })
      .catch(() => {
        if (!cancelled) setFallbacks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.name]);

  const loadSessionHistory = useCallback(
    async (sessionId: string, titleHint?: string | null) => {
      setLoadingChat(true);
      setChatError(null);
      setActiveSessionId(sessionId);
      setActiveTitle(titleHint?.trim() || "Unterhaltung");
      setIsStreaming(false);
      setLiveStatus(null);
      setActiveTool(null);
      setPendingApproval(null);
      setPendingConnection(null);
      setPendingClarify(null);
      setPendingSecret(null);
      setUsageLimitError(null);
      attachedOnWsRef.current = false;

      try {
        if (wsState === "connected") {
          const snapshot = await hermesWs.call<{
            session_id?: string;
            messages?: unknown[];
            running?: boolean;
            execution_generation?: number;
            inflight?: { assistant?: string; streaming?: boolean } | null;
            pending_approval?: HermesPendingApproval | null;
            prompts?: HermesPendingApproval[];
            pending_connection?: HermesConnectionRequest | null;
            usage?: Record<string, unknown> | null;
            info?: { usage?: Record<string, unknown> | null } | null;
          }>("session.resume", {
            session_id: sessionId,
            profile: profile.name,
          });
          const resolvedSid = snapshot?.session_id || sessionId;
          if (snapshot?.session_id) {
            setActiveSessionId(snapshot.session_id);
          }
          if (typeof snapshot?.execution_generation === "number") {
            execGenerationRef.current = snapshot.execution_generation;
          }
          attachedOnWsRef.current = true;
          let loaded = normalizeMessages(snapshot?.messages || []);
          if (loaded.length === 0 && resolvedSid) {
            const restLoaded = await fetchSessionMessages(resolvedSid, profile.name).catch(() => []);
            if (restLoaded.length > 0) loaded = restLoaded;
          }
          if (snapshot?.inflight?.assistant) {
            loaded.push({
              id: "inflight",
              role: "assistant",
              content: snapshot.inflight.assistant,
              streaming: Boolean(snapshot.inflight.streaming || snapshot.running),
            });
          }
          setMessages(loaded);
          onRegisterSession?.(profile.name, resolvedSid);
          onMarkBotRead?.(profile.name, { sessionId: resolvedSid, messages: loaded });
          setIsStreaming(Boolean(snapshot?.running || snapshot?.inflight?.streaming));
          setPendingApproval(snapshot?.pending_approval || snapshot?.prompts?.[0] || null);
          setPendingConnection(snapshot?.pending_connection || null);
          const snapUsage = snapshot?.usage || snapshot?.info?.usage;
          if (snapUsage && typeof snapUsage === "object") {
            setUsage((prev) => mergeUsagePayload(prev, snapUsage));
          }
          void refreshAccountUsage(resolvedSid);
        } else {
          const loaded = await fetchSessionMessages(sessionId, profile.name);
          setMessages(loaded);
          onRegisterSession?.(profile.name, sessionId);
          onMarkBotRead?.(profile.name, { sessionId, messages: loaded });
        }
        scrollToBottom();
      } catch (err) {
        try {
          const loaded = await fetchSessionMessages(sessionId, profile.name);
          setMessages(loaded);
        } catch {
          setChatError(
            err instanceof Error ? err.message : "Chatverlauf konnte nicht geladen werden."
          );
        }
      } finally {
        setLoadingChat(false);
      }
    },
    [profile.name, scrollToBottom, wsState]
  );

  const openCanonicalBotChat = useCallback(
    async (existingSessions?: HermesSessionSummary[], silentReattach = false) => {
      if (!silentReattach) {
        setLoadingChat(true);
      }
      setChatError(null);
      setPendingApproval(null);
      setPendingConnection(null);
      setPendingClarify(null);
      setPendingSecret(null);
      setUsageLimitError(null);
      attachedOnWsRef.current = false;

      try {
        // If no canonical "Bot Chat" exists yet, promote the bot's existing latest
        // interactive chat (e.g. from before Bot Mode) to "Bot Chat" first so its
        // message history stays right on screen instead of starting blank.
        const list = existingSessions ?? sessions;
        const hasCanonical = list.some((s) => (s.title || "").trim() === canonicalTitle);
        if (!hasCanonical) {
          const existing = pickPreferredBotSession(list);
          if (existing) {
            await renameSession(existing.id, canonicalTitle, profile.name).catch(() => null);
          }
        }

        const snapshot = await hermesWs.call<{
          session_id?: string;
          messages?: unknown[];
          running?: boolean;
          execution_generation?: number;
          inflight?: { assistant?: string; streaming?: boolean } | null;
          pending_approval?: HermesPendingApproval | null;
          prompts?: HermesPendingApproval[];
          pending_connection?: HermesConnectionRequest | null;
          usage?: Record<string, unknown> | null;
          info?: { usage?: Record<string, unknown> | null } | null;
        }>("session.create", {
          profile: profile.name,
          request_id: randomClientId(isPrivateBot ? "privchat" : "botchat"),
          source: "gui",
          title: canonicalTitle,
        });

        const resolvedSid = snapshot?.session_id || null;
        setActiveSessionId(resolvedSid);
        setActiveTitle(canonicalTitle);
        if (typeof snapshot?.execution_generation === "number") {
          execGenerationRef.current = snapshot.execution_generation;
        }
        attachedOnWsRef.current = Boolean(resolvedSid);

        let loaded = normalizeMessages(snapshot?.messages || []);
        if (loaded.length === 0 && resolvedSid) {
          const restLoaded = await fetchSessionMessages(resolvedSid, profile.name).catch(() => []);
          if (restLoaded.length > 0) loaded = restLoaded;
        }
        if (snapshot?.inflight?.assistant) {
          loaded.push({
            id: "inflight",
            role: "assistant",
            content: snapshot.inflight.assistant,
            streaming: Boolean(snapshot.inflight.streaming || snapshot.running),
          });
        }
        if (loaded.length > 0 || !silentReattach) {
          setMessages(loaded);
        }
        onRegisterSession?.(profile.name, resolvedSid);
        onMarkBotRead?.(profile.name, { sessionId: resolvedSid, messages: loaded });
        setIsStreaming(Boolean(snapshot?.running || snapshot?.inflight?.streaming));
        setPendingApproval(snapshot?.pending_approval || snapshot?.prompts?.[0] || null);
        setPendingConnection(snapshot?.pending_connection || null);
        const snapUsage = snapshot?.usage || snapshot?.info?.usage;
        if (snapUsage && typeof snapUsage === "object") {
          setUsage((prev) => mergeUsagePayload(prev, snapUsage));
        }
        void refreshAccountUsage(resolvedSid);
        if (!silentReattach) {
          scrollToBottom();
        }
      } catch (err) {
        setChatError(
          err instanceof Error ? err.message : "Bot-Chat konnte nicht geöffnet werden."
        );
      } finally {
        setLoadingChat(false);
      }
    },
    [profile.name, refreshAccountUsage, scrollToBottom, sessions]
  );

  const refreshSessionsList = useCallback(
    async (autoOpenFirst = false) => {
      try {
        const list = await fetchSessions(profile.name, 30);
        setSessions(list);
        if (autoOpenFirst) {
          if (initialSessionId) {
            await loadSessionHistory(initialSessionId, initialSessionTitle || "Suchtreffer");
            return;
          }
          if (wsState === "connected") {
            await openCanonicalBotChat(list, false);
            const refreshed = await fetchSessions(profile.name, 30).catch(() => list);
            setSessions(refreshed);
            return;
          }
          const preferred = pickPreferredBotSession(list);
          if (preferred) {
            await loadSessionHistory(preferred.id, preferred.title || canonicalTitle);
          } else {
            setActiveSessionId(null);
            setActiveTitle(canonicalTitle);
            setMessages([]);
            attachedOnWsRef.current = false;
            setLoadingChat(false);
          }
        }
      } catch (err) {
        setChatError(err instanceof Error ? err.message : "Sessions konnten nicht geladen werden.");
        setLoadingChat(false);
      }
    },
    [
      canonicalTitle,
      initialSessionId,
      initialSessionTitle,
      loadSessionHistory,
      openCanonicalBotChat,
      profile.name,
      wsState,
    ]
  );

  useEffect(() => {
    void refreshSessionsList(true);
  }, [profile.name, initialSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wsState !== "connected") {
      // Gateway drops WS subscriptions on disconnect/restart — force clean re-attach on reconnect
      attachedOnWsRef.current = false;
      return;
    }
    if (!attachedOnWsRef.current) {
      if (activeSessionId && activeTitle !== canonicalTitle) {
        void loadSessionHistory(activeSessionId, activeTitle);
      } else {
        void openCanonicalBotChat(undefined, messages.length > 0);
      }
    } else {
      void refreshAccountUsage(activeSessionId);
    }
  }, [wsState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle server -> client requests (clarify, approval, secret, sudo, vault.*)
  useEffect(() => {
    return hermesWs.onServerRequest((req) => {
      const reqSid = typeof req.params.session_id === "string" ? req.params.session_id : null;
      if (reqSid && activeSessionRef.current && reqSid !== activeSessionRef.current) {
        hermesWs.sendErrorResponse(req.id, 4404, "Session not shown");
        return;
      }
      if (req.method === "clarify" || req.method === "clarify.request") {
        setPendingClarify(req);
        notifyIfBackgrounded({
          title: visual.label,
          body: "Rückfrage im Chat – bitte kurz auswählen.",
          bot: profile.name,
        });
        scrollToBottomWithSettle();
      } else if (req.method === "approval") {
        const appr: HermesPendingApproval = {
          ...(req.params as HermesPendingApproval),
          server_request_id: req.id,
        };
        const decision = evaluateApprovalPolicy(appr, loadAutoApproveSafe());
        if (decision.action === "auto_once") {
          hermesWs.sendResponse(req.id, { choice: "once" });
          const label = appr.description || appr.command || appr.tool_name || "Aktion";
          appendSystemNotice(`Automatisch freigegeben: ${String(label).slice(0, 90)}`);
        } else {
          setPendingApproval({
            ...appr,
            risk: decision.reason || appr.risk,
          });
          notifyIfBackgrounded({
            title: `${visual.label} · Freigabe nötig`,
            body: decision.reason || "Der Bot bittet um deine Freigabe.",
            bot: profile.name,
          });
          scrollToBottomWithSettle();
        }
      } else if (SECRET_REQUEST_METHODS.has(req.method)) {
        setPendingSecret(req);
        notifyIfBackgrounded({
          title: `${visual.label} · Sichere Abfrage`,
          body: "Passwort oder API-Key wird sicher angefordert.",
          bot: profile.name,
        });
        scrollToBottomWithSettle();
      } else {
        // Decline desktop-only window requests cleanly so the agent doesn't wait 300s
        hermesWs.sendErrorResponse(req.id, 4404, "Not supported on mobile web client");
      }
    });
  }, [scrollToBottomWithSettle]);

  useEffect(() => {
    const unsubscribe = hermesWs.onEvent((ev) => {
      const currentSid = activeSessionRef.current;
      if (ev.sessionId && currentSid && ev.sessionId !== currentSid) {
        return;
      }

      if (typeof ev.payload.execution_generation === "number") {
        execGenerationRef.current = ev.payload.execution_generation;
      }

      if (ev.type === "message.start") {
        setIsStreaming(true);
        setLiveStatus(null);
        setMessages((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].streaming) return prev;
          return [
            ...prev,
            {
              id: `stream-${Date.now()}`,
              role: "assistant",
              content: "",
              reasoning: "",
              streaming: true,
              timestamp: Date.now(),
            },
          ];
        });
        scrollToBottom();
      } else if (ev.type === "message.delta") {
        const chunk = typeof ev.payload.text === "string" ? ev.payload.text : "";
        if (!chunk) return;
        setIsStreaming(true);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, content: last.content + chunk };
          } else {
            next.push({
              id: `stream-${Date.now()}`,
              role: "assistant",
              content: chunk,
              streaming: true,
              timestamp: Date.now(),
            });
          }
          return next;
        });
        scrollToBottom();
      } else if (ev.type === "reasoning.delta" || ev.type === "thinking.delta") {
        const chunk = typeof ev.payload.text === "string" ? ev.payload.text : "";
        if (!chunk) return;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            next[next.length - 1] = {
              ...last,
              reasoning: (last.reasoning || "") + chunk,
            };
          } else {
            next.push({
              id: `stream-${Date.now()}`,
              role: "assistant",
              content: "",
              reasoning: chunk,
              streaming: true,
              timestamp: Date.now(),
            });
          }
          return next;
        });
      } else if (ev.type === "tool.start" || ev.type === "tool.progress") {
        const toolName =
          (typeof ev.payload.tool_name === "string" && ev.payload.tool_name) ||
          (typeof ev.payload.name === "string" && ev.payload.name) ||
          "Werkzeug";
        setActiveTool(toolName);
      } else if (ev.type === "tool.complete" || ev.type === "tool.end") {
        setActiveTool(null);
      } else if (ev.type === "status.update") {
        if (typeof ev.payload.text === "string" && ev.payload.text) {
          setLiveStatus(ev.payload.text);
        }
      } else if (ev.type === "session.usage" || ev.type === "session.info") {
        const usageObj =
          ev.type === "session.info" && ev.payload.usage && typeof ev.payload.usage === "object"
            ? (ev.payload.usage as Record<string, unknown>)
            : ev.payload;
        setUsage((prev) => mergeUsagePayload(prev, usageObj));
      } else if (ev.type === "request.cancel") {
        const cancelledId = ev.payload.request_id;
        if (cancelledId !== undefined) {
          setPendingClarify((cur) => (cur && String(cur.id) === String(cancelledId) ? null : cur));
          setPendingSecret((cur) => (cur && String(cur.id) === String(cancelledId) ? null : cur));
          setPendingApproval((cur) =>
            cur &&
            (String(cur.server_request_id) === String(cancelledId) ||
              String(cur.request_id) === String(cancelledId))
              ? null
              : cur
          );
        }
      } else if (ev.type === "message.complete") {
        const finalText = typeof ev.payload.text === "string" ? ev.payload.text : "";
        const finalReasoning =
          typeof ev.payload.reasoning === "string" ? ev.payload.reasoning : undefined;
        const errMsg = typeof ev.payload.error === "string" ? ev.payload.error : null;

        if (ev.payload.usage && typeof ev.payload.usage === "object") {
          setUsage((prev) => mergeUsagePayload(prev, ev.payload.usage as Record<string, unknown>));
        }
        const errSurface = ev.payload.error_surface as HermesErrorSurface | undefined;
        if (errSurface?.usage_limit) {
          setUsageLimitError(errSurface.usage_limit);
        } else if (
          errSurface?.code &&
          /limit|quota|rate|429|capacity/i.test(errSurface.code)
        ) {
          setUsageLimitError({
            limit_name: "Anbieter-Limit erreicht",
            message: errMsg || "Das Kontingent dieses Anbieters wurde erreicht.",
            resets_at_ms: errSurface.resets_at ? errSurface.resets_at * 1000 : null,
          });
        } else if (!errMsg) {
          setUsageLimitError(null);
        }

        setIsStreaming(false);
        setActiveTool(null);
        setLiveStatus(null);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            next[next.length - 1] = {
              ...last,
              content: finalText || last.content,
              reasoning: finalReasoning ?? last.reasoning,
              streaming: false,
              error: errMsg,
            };
          } else if (finalText || errMsg) {
            next.push({
              id: `done-${Date.now()}`,
              role: "assistant",
              content: finalText,
              reasoning: finalReasoning,
              streaming: false,
              error: errMsg,
              timestamp: Date.now(),
            });
          }
          return next;
        });
        // Automatically detect when a bot asks for a Vault entry (card/address/shop login)
        // OR a single/multi-field .env secret form and pop up the protected card in chat.
        if (finalText) {
          const detectedVault = detectBotVaultRequest(finalText);
          if (detectedVault) {
            setPendingVaultForm(detectedVault);
          } else {
            const detectedForm = detectBotSecretForm(finalText);
            if (detectedForm && detectedForm.fields.length > 0) {
              setManualSecret({
                open: true,
                formTitle: detectedForm.title,
                initialKey: detectedForm.fields[0].keyName,
                promptText: detectedForm.fields[0].prompt,
                fields: detectedForm.fields.length > 1 ? detectedForm.fields : undefined,
              });
            }
          }
          if (!isPrivateBot) {
            notifyIfBackgrounded({
              title: visual.label,
              body: stripSecretRequestTag(finalText).slice(0, 180),
              bot: profile.name,
            });
          }
        }
        if (document.visibilityState === "visible") {
          onMarkBotRead?.(profile.name, {
            sessionId: activeSessionRef.current,
            lastActiveMs: Date.now(),
          });
        }
        void refreshAccountUsage(activeSessionRef.current);
        scrollIfNearBottom();
      } else if (ev.type === "approval.requested") {
        const appr = ev.payload as HermesPendingApproval;
        const decision = evaluateApprovalPolicy(appr, loadAutoApproveSafe());
        const sid = activeSessionRef.current;
        const promptId = appr.prompt_id || appr.request_id || appr.approval_id || appr.id;
        if (decision.action === "auto_once" && sid && promptId) {
          void hermesWs
            .call("approval.respond", {
              session_id: sid,
              profile: profile.name,
              execution_generation: appr.execution_generation ?? execGenerationRef.current,
              prompt_id: promptId,
              choice: "once",
            })
            .then(() => {
              const label = appr.description || appr.command || appr.tool_name || "Aktion";
              appendSystemNotice(`Automatisch freigegeben: ${String(label).slice(0, 90)}`);
            })
            .catch(() => {
              setPendingApproval(appr);
            });
        } else {
          setPendingApproval({
            ...appr,
            risk: decision.reason || appr.risk,
          });
          notifyIfBackgrounded({
            title: `${visual.label} · Freigabe nötig`,
            body: decision.reason || "Der Bot bittet um eine Freigabe.",
            bot: profile.name,
          });
          scrollToBottomWithSettle();
        }
      } else if (ev.type === "approval.cancelled") {
        setPendingApproval(null);
      } else if (ev.type === "connection.request" || ev.type === "connection.update") {
        const req = ev.payload as unknown as HermesConnectionRequest;
        if (req?.settled) {
          setPendingConnection(null);
        } else if (req?.targets) {
          setPendingConnection(req);
          scrollToBottomWithSettle();
        }
      } else if (ev.type === "error") {
        setIsStreaming(false);
        setActiveTool(null);
        if (typeof ev.payload.message === "string") {
          setChatError(ev.payload.message);
        }
      }
    });

    return unsubscribe;
  }, [refreshAccountUsage, scrollToBottom, scrollToBottomWithSettle]);

  function autoResizeInput(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }

  async function startNewChat() {
    setShowSessionsSheet(false);
    setChatError(null);
    setIsStreaming(false);
    setLiveStatus(null);
    setActiveTool(null);
    setPendingApproval(null);
    setPendingConnection(null);
    setPendingClarify(null);
    setPendingSecret(null);
    setUsageLimitError(null);
    setUsage((prev) => ({
      ...prev,
      contextTokens: null,
      contextPercent: 0,
      totalTokens: null,
    }));

    // Archive the current canonical chat cleanly (preserving 100% of its messages in Chat-Verlauf)
    // and immediately create a genuinely new canonical Bot Chat / Privater Chat with 0% context.
    const previousSid = activeSessionRef.current;
    if (previousSid && activeTitle === canonicalTitle) {
      const stamp = new Date().toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const archiveTitle = `Chat ${stamp}`;
      // Update both REST (?profile=...) and WS gateway title so canonical title is freed immediately
      await Promise.all([
        renameSession(previousSid, archiveTitle, profile.name).catch(() => null),
        wsState === "connected"
          ? hermesWs
              .call("session.title", {
                session_id: previousSid,
                profile: profile.name,
                title: archiveTitle,
              })
              .catch(() => null)
          : Promise.resolve(),
      ]);
    }

    if (wsState === "connected") {
      try {
        let created = await hermesWs.call<{
          session_id: string;
          execution_generation?: number;
        }>("session.create", {
          profile: profile.name,
          request_id: randomClientId("new"),
          source: "gui",
          title: canonicalTitle,
        });
        // Safety net: if gateway still resolved to the previous session ID, mint an untitled fresh session
        if (previousSid && created.session_id === previousSid) {
          created = await hermesWs.call<{
            session_id: string;
            execution_generation?: number;
          }>("session.create", {
            profile: profile.name,
            request_id: randomClientId("fresh"),
            source: "gui",
          });
        }
        setActiveSessionId(created.session_id);
        setActiveTitle(canonicalTitle);
        onRegisterSession?.(profile.name, created.session_id);
        onMarkBotRead?.(profile.name, { sessionId: created.session_id, lastActiveMs: Date.now() });
        if (typeof created.execution_generation === "number") {
          execGenerationRef.current = created.execution_generation;
        }
        attachedOnWsRef.current = true;
        setMessages([
          {
            id: `sys-new-${Date.now()}`,
            role: "system",
            content: previousSid
              ? "Neue Session gestartet (vorheriger Chat bleibt im Verlauf gespeichert)."
              : "Neue Session gestartet.",
            timestamp: Date.now(),
          },
        ]);
        void refreshSessionsList(false);
        return;
      } catch (err) {
        setChatError(
          err instanceof Error ? err.message : "Neue Session konnte nicht erstellt werden."
        );
      }
    }

    setActiveSessionId(null);
    setActiveTitle(canonicalTitle);
    setMessages([]);
    attachedOnWsRef.current = false;
  }

  function handleAddFiles(fileList: FileList | null, forceImage = false) {
    if (!fileList || fileList.length === 0) return;
    const added: QueuedAttachment[] = [];
    for (const file of Array.from(fileList).slice(0, 6)) {
      const isImage = forceImage || file.type.startsWith("image/");
      added.push({
        id: randomClientId("att"),
        file,
        isImage,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      });
    }
    setAttachments((prev) => [...prev, ...added].slice(0, 8));
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  function appendSystemNotice(text: string) {
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        role: "system",
        content: text,
        timestamp: Date.now(),
      },
    ]);
    scrollToBottom();
  }

  async function tryHandleSlashCommand(rawText: string): Promise<boolean> {
    if (!rawText.startsWith("/")) return false;
    const [cmdRaw, ...rest] = rawText.trim().split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const arg = rest.join(" ").trim();

    if (cmd === "/new" || cmd === "/neu") {
      await startNewChat();
      return true;
    }

    if (cmd === "/help" || cmd === "/hilfe") {
      appendSystemNotice(
        "Chat-Befehle: /model (Modell & Fallback) · /provider <Anbieter> · /limit (Verbrauch) · /secret [KEY] (Passwort/API-Key sicher speichern) · /new (neuer Chat)"
      );
      return true;
    }

    if (cmd === "/limit" || cmd === "/usage") {
      void refreshAccountUsage(activeSessionId);
      setShowLimitSheet(true);
      return true;
    }

    if (cmd === "/secret" || cmd === "/key" || cmd === "/passwort") {
      setManualSecret({ open: true, initialKey: arg });
      scrollToBottomWithSettle();
      return true;
    }

    if (cmd === "/provider" || cmd === "/anbieter") {
      setModelPickerState({ open: true, search: "", provider: arg });
      return true;
    }

    if (cmd === "/model" || cmd === "/modell") {
      if (!arg) {
        setModelPickerState({ open: true, search: "", provider: "" });
        return true;
      }

      // Support explicit provider/model syntax or fuzzy search across configured Hermes providers
      try {
        const options = await fetchModelOptions(profile.name, false);
        const providers = options.providers || [];

        if (arg.includes("/")) {
          const [provRaw, ...modelParts] = arg.split("/");
          const modelQuery = modelParts.join("/").trim();
          const matchedProv = providers.find(
            (p) =>
              p.slug.toLowerCase() === provRaw.toLowerCase() ||
              p.name.toLowerCase() === provRaw.toLowerCase()
          );
          if (matchedProv && modelQuery) {
            const exactModel =
              matchedProv.models.find((m) => m.toLowerCase() === modelQuery.toLowerCase()) ||
              modelQuery;
            const res = await updateProfileModel(profile.name, matchedProv.slug, exactModel);
            setActiveModelOverride({ provider: res.provider, model: res.model });
            appendSystemNotice(`Modell gewechselt: ${res.provider} / ${res.model}`);
            void onRefreshProfiles();
            return true;
          }
        }

        const q = arg.toLowerCase();
        const matches: Array<{ provider: string; model: string }> = [];
        for (const p of providers) {
          for (const m of p.models || []) {
            if (m.toLowerCase() === q) {
              matches.unshift({ provider: p.slug, model: m });
            } else if (m.toLowerCase().includes(q)) {
              matches.push({ provider: p.slug, model: m });
            }
          }
        }

        const exact = matches.find((m) => m.model.toLowerCase() === q);
        if (exact || matches.length === 1) {
          const target = exact || matches[0];
          const res = await updateProfileModel(profile.name, target.provider, target.model);
          setActiveModelOverride({ provider: res.provider, model: res.model });
          appendSystemNotice(`Modell gewechselt: ${res.provider} / ${res.model}`);
          void onRefreshProfiles();
          return true;
        }

        // Multiple or no exact match: open picker pre-filtered so the user picks with one tap
        setModelPickerState({ open: true, search: arg, provider: "" });
        return true;
      } catch (err) {
        setChatError(
          err instanceof Error ? err.message : "Modellwechsel fehlgeschlagen."
        );
        return true;
      }
    }

    return false;
  }

  async function handleSend() {
    stopActiveDictation();
    const rawText = (textareaRef.current?.value ?? input).trim();
    const pendingFiles = [...attachments];
    if (!rawText && pendingFiles.length === 0) return;

    const quotePrefix = replyTo
      ? `> ${replyTo.author}: ${replyTo.excerpt}\n\n`
      : "";
    const text = quotePrefix ? `${quotePrefix}${rawText}` : rawText;

    // Handle /model, /provider, /new, /help directly in chat
    if (pendingFiles.length === 0 && !replyTo && rawText.startsWith("/")) {
      setInput("");
      saveBotDraft(profile.name, "");
      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.style.height = "auto";
      }
      const handled = await tryHandleSlashCommand(rawText);
      if (handled) return;
      // Unknown slash command falls through as normal text
    }

    if (wsState !== "connected") {
      setChatError("Keine Live-Verbindung zum Hermes-Gateway. Bitte kurz warten.");
      return;
    }

    setChatError(null);
    setInput("");
    saveBotDraft(profile.name, "");
    setReplyTo(null);
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
    // Guard against late iOS keyboard dictation commits arriving right after send
    window.setTimeout(() => {
      setInput((cur) => (cur.trim() === rawText ? "" : cur));
      if (textareaRef.current && textareaRef.current.value.trim() === rawText) {
        textareaRef.current.value = "";
        textareaRef.current.style.height = "auto";
      }
    }, 90);

    let sid = activeSessionId;
    const optimisticId = `u-${Date.now()}`;
    let appendedOptimistic = false;
    try {
      if (!sid) {
        const hasCanonical = sessions.some((s) => (s.title || "").trim() === canonicalTitle);
        const created = await hermesWs.call<{
          session_id: string;
          stored_session_id?: string;
          execution_generation?: number;
        }>("session.create", {
          profile: profile.name,
          request_id: randomClientId("req"),
          source: "gui",
          ...(!hasCanonical ? { title: canonicalTitle } : {}),
        });
        sid = created.session_id;
        if (typeof created.execution_generation === "number") {
          execGenerationRef.current = created.execution_generation;
        }
        attachedOnWsRef.current = true;
        setActiveSessionId(sid);
        onRegisterSession?.(profile.name, sid);
        setActiveTitle(
          !hasCanonical ? canonicalTitle : (text || pendingFiles[0]?.file.name || "Chat").slice(0, 48)
        );
        void refreshSessionsList(false);
      } else if (!attachedOnWsRef.current) {
        const resumed = await hermesWs.call<{
          session_id?: string;
          execution_generation?: number;
        }>("session.resume", {
          session_id: sid,
          profile: profile.name,
          omit_messages: true,
        });
        if (resumed?.session_id) sid = resumed.session_id;
        if (typeof resumed?.execution_generation === "number") {
          execGenerationRef.current = resumed.execution_generation;
        }
        attachedOnWsRef.current = true;
      }

      // Stage any selected images and files natively in Hermes before prompt.submit
      const imageAttachments: Array<{ path: string; mime: string }> = [];
      const fileRefs: string[] = [];

      if (pendingFiles.length > 0) {
        setUploadingAttachments(true);
        for (const item of pendingFiles) {
          if (item.isImage) {
            const dataUrl = await prepareChatImageDataUrl(item.file, 1600);
            const staged = await hermesWs.call<{ path?: string; mime?: string }>(
              "image.attach_bytes",
              {
                session_id: sid,
                profile: profile.name,
                content_base64: dataUrl,
                filename: item.file.name || "photo.jpg",
              },
              30_000
            );
            if (staged?.path) {
              imageAttachments.push({
                path: staged.path,
                mime: staged.mime || "image/jpeg",
              });
            }
          } else {
            const uploaded = await uploadChatFile(item.file, profile.name);
            const attached = await hermesWs.call<{ ref_text?: string; path?: string }>(
              "file.attach",
              {
                session_id: sid,
                profile: profile.name,
                ...(uploaded.staged_upload
                  ? { staged_upload: uploaded.staged_upload }
                  : { path: uploaded.path }),
                name: item.file.name,
              },
              30_000
            );
            if (attached?.ref_text) {
              fileRefs.push(attached.ref_text);
            } else if (uploaded.path) {
              fileRefs.push(`[Datei: ${item.file.name} (${uploaded.path})]`);
            }
          }
        }
        setUploadingAttachments(false);
      }

      const combinedText = [
        ...fileRefs,
        text || (imageAttachments.length > 0 ? "Bitte schau dir dieses Bild an." : ""),
      ]
        .filter(Boolean)
        .join("\n\n");

      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          role: "user",
          content: text,
          timestamp: Date.now(),
          attachments: pendingFiles.map((a) => ({
            name: a.file.name,
            isImage: a.isImage,
            previewUrl: a.previewUrl,
          })),
        },
      ]);
      appendedOptimistic = true;
      setIsStreaming(true);
      scrollToBottom();

      await hermesWs.call("prompt.submit", {
        session_id: sid,
        profile: profile.name,
        submission_id: randomClientId("sub"),
        text: combinedText,
        ...(imageAttachments.length > 0 ? { attachments: imageAttachments } : {}),
        ...(activeModelOverride ? { model_override: activeModelOverride } : {}),
      });
    } catch (err) {
      setUploadingAttachments(false);
      setIsStreaming(false);
      if (appendedOptimistic) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      }
      setInput(text);
      if (pendingFiles.length > 0) setAttachments(pendingFiles);
      setChatError(err instanceof Error ? err.message : "Nachricht konnte nicht gesendet werden.");
    }
  }

  async function handleInterrupt() {
    if (!activeSessionId || wsState !== "connected") return;
    try {
      await hermesWs.call("session.interrupt", {
        session_id: activeSessionId,
        profile: profile.name,
        execution_generation: execGenerationRef.current,
      });
      setIsStreaming(false);
      setActiveTool(null);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Konnte Antwort nicht stoppen.");
    }
  }

  async function handleApprovalDecision(choice: "once" | "session" | "always" | "deny") {
    if (!pendingApproval) return;
    if (pendingApproval.server_request_id !== undefined) {
      hermesWs.sendResponse(pendingApproval.server_request_id, { choice });
      setPendingApproval(null);
      return;
    }
    if (!activeSessionId) return;
    const promptId =
      pendingApproval.prompt_id ||
      pendingApproval.request_id ||
      pendingApproval.approval_id ||
      pendingApproval.id;
    try {
      await hermesWs.call("approval.respond", {
        session_id: activeSessionId,
        profile: profile.name,
        execution_generation:
          pendingApproval.execution_generation ?? execGenerationRef.current,
        prompt_id: promptId,
        choice,
      });
      setPendingApproval(null);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Freigabe konnte nicht übermittelt werden.");
    }
  }

  function handleClarifySubmit(
    answers: Record<string, string | null>,
    outcome: "submitted" | "cancelled"
  ) {
    if (!pendingClarify) return;
    if (outcome === "cancelled") {
      hermesWs.sendResponse(pendingClarify.id, { outcome: "cancelled" });
    } else {
      hermesWs.sendResponse(pendingClarify.id, { answers, outcome: "submitted" });
    }
    setPendingClarify(null);
  }

  function handleSecretSubmit(value: string) {
    if (!pendingSecret) return;
    hermesWs.sendResponse(pendingSecret.id, { value });
    setPendingSecret(null);
    appendSystemNotice("Sichere Eingabe verschlüsselt an den Bot übermittelt.");
  }

  function handleSecretCancel() {
    if (!pendingSecret) return;
    hermesWs.sendResponse(pendingSecret.id, { value: "" });
    setPendingSecret(null);
  }

  async function handleQuickSwitchToFallback() {
    const target = fallbacks[0] || RECOMMENDED_ANTHROPIC_FALLBACK;
    setSwitchingFallback(true);
    try {
      const res = await updateProfileModel(profile.name, target.provider, target.model);
      setActiveModelOverride({ provider: res.provider, model: res.model });
      setUsageLimitError(null);
      appendSystemNotice(`Auf Fallback gewechselt: ${res.provider} / ${res.model}`);
      void onRefreshProfiles();
    } catch (err) {
      setChatError(
        err instanceof Error ? err.message : "Wechsel auf Anthropic-Fallback fehlgeschlagen."
      );
    } finally {
      setSwitchingFallback(false);
    }
  }

  async function handleConfirmDeleteSession() {
    if (!sessionToDelete) return;
    setDeletingSession(true);
    try {
      await deleteSession(sessionToDelete.id, profile.name);
      const next = sessions.filter((s) => s.id !== sessionToDelete.id);
      setSessions(next);
      if (activeSessionId === sessionToDelete.id) {
        if (next.length > 0) {
          await loadSessionHistory(next[0].id, next[0].title);
        } else {
          await startNewChat();
        }
      }
      setSessionToDelete(null);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Chat konnte nicht gelöscht werden.");
    } finally {
      setDeletingSession(false);
    }
  }

  const teammates = useMemo(() => {
    if (isPrivateBot) return [];
    return allProfiles
      .filter((p) => p.name !== profile.name)
      .map((p) => {
        const vis = getBotVisual(p);
        return {
          name: p.name,
          label: vis.label,
          handle: getBotHandle(p.name, allProfileNames),
        };
      });
  }, [allProfileNames, allProfiles, isPrivateBot, profile.name]);

  const limitSummary = useMemo(() => getPrimaryLimitSummary(usage), [usage]);
  const primaryFallback = fallbacks[0] || RECOMMENDED_ANTHROPIC_FALLBACK;
  const hasAnthropicFallback = fallbacks.some((f) =>
    f.provider.toLowerCase().includes("anthropic")
  );
  const currentActiveModel =
    activeModelOverride?.model || usage.model || profile.model || "Standard";
  const currentActiveProvider =
    activeModelOverride?.provider || usage.provider || profile.provider || null;

  return (
    <div
      className="chat-screen"
      onTouchStart={(e) => {
        if (hideBackButton || e.touches.length !== 1) return;
        const t = e.touches[0];
        if (t.clientX <= 28) {
          swipeStartRef.current = { x: t.clientX, y: t.clientY };
        } else {
          swipeStartRef.current = null;
        }
      }}
      onTouchEnd={(e) => {
        const start = swipeStartRef.current;
        swipeStartRef.current = null;
        if (!start || hideBackButton || e.changedTouches.length !== 1) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = Math.abs(t.clientY - start.y);
        if (dx > 72 && dx > dy * 1.6) {
          onBack();
        }
      }}
    >
      <header className="chat-floating-header">
        {!hideBackButton ? (
          <button
            type="button"
            className="glass-circle-btn"
            aria-label={
              otherUnreadCount > 0
                ? `Zurück zu Bots (${otherUnreadCount} neue ${otherUnreadCount === 1 ? "Nachricht" : "Nachrichten"})`
                : "Zurück zu Bots"
            }
            onClick={onBack}
          >
            <ChevronLeft size={22} />
            {otherUnreadCount > 0 && (
              <span className="back-unread-badge" aria-hidden="true">
                {formatBadgeCount(otherUnreadCount)}
              </span>
            )}
          </button>
        ) : (
          <div style={{ width: 42, height: 42, flexShrink: 0 }} aria-hidden="true" />
        )}

        <div className="glass-title-pill-group">
          <button
            type="button"
            className="glass-avatar-trigger"
            aria-label={`Profilbild von ${visual.label} groß anzeigen`}
            onClick={() => setShowAvatarLightbox(true)}
          >
            <BotAvatar visual={visual} imageUrl={avatarUrl} size="sm" />
          </button>
          <button
            type="button"
            className="glass-title-trigger"
            onClick={onOpenBotSettings}
          >
            {isPrivateBot && (
              <Lock size={12} style={{ color: "var(--status-ok)", flexShrink: 0 }} />
            )}
            <span className="glass-title-pill-label">{visual.label}</span>
          </button>
        </div>

        <button
          type="button"
          className="glass-circle-btn"
          aria-label="Chat-Optionen"
          onClick={() => setShowActionsSheet(true)}
        >
          <MoreHorizontal size={20} />
        </button>
      </header>

      {inChatSearchOpen && (
        <div className="in-chat-search-bar" role="search" aria-label="Im Chat suchen">
          <Search size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            ref={searchInputRef}
            type="search"
            className="in-chat-search-input"
            value={inChatSearchQuery}
            onChange={(e) => setInChatSearchQuery(e.target.value)}
            placeholder="Im Chat suchen…"
          />
          {inChatSearchQuery.trim() && (
            <span className="in-chat-search-count">
              {inChatMatchIndices.length > 0
                ? `${Math.min(activeMatchPos + 1, inChatMatchIndices.length)}/${inChatMatchIndices.length}`
                : "0"}
            </span>
          )}
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Vorheriger Treffer"
            disabled={inChatMatchIndices.length === 0}
            onClick={() => jumpToSearchMatch(activeMatchPos - 1, inChatMatchIndices)}
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Nächster Treffer"
            disabled={inChatMatchIndices.length === 0}
            onClick={() => jumpToSearchMatch(activeMatchPos + 1, inChatMatchIndices)}
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Suche schließen"
            onClick={() => {
              setInChatSearchOpen(false);
              setInChatSearchQuery("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div ref={scrollRef} className="chat-messages" onScroll={handleMessagesScroll}>
        {wsState !== "connected" && (
          <div className="notice warn">
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Verbindung: {wsState === "connecting" ? "wird aufgebaut…" : "getrennt – verbinde neu…"}
            </span>
          </div>
        )}

        {chatError && (
          <div className="notice err">
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{chatError}</span>
          </div>
        )}

        {loadingChat ? (
          <div className="empty-state" style={{ background: "transparent", border: "none" }}>
            <p>Lade Verlauf…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 32, background: "transparent", border: "none" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <BotAvatar visual={visual} imageUrl={avatarUrl} size="lg" />
            </div>
            <h3>{visual.label}</h3>
            <p>{profile.description || `Schreibe eine Nachricht an ${visual.label}.`}</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const curMs = toTimestampMs(msg.timestamp);
            const prevMs = i > 0 ? toTimestampMs(messages[i - 1].timestamp) : null;
            const showDivider =
              curMs !== null && (prevMs === null || curMs - prevMs > 10 * 60 * 1000);

            const isSilentAck =
              msg.role === "assistant" &&
              !msg.streaming &&
              !msg.error &&
              /^(?:\[SILENT\]|NO_REPLY)$/i.test(msg.content.trim());
            if (isSilentAck) return null;

            const isEmptyAssistant =
              msg.role === "assistant" &&
              !msg.streaming &&
              !msg.content.trim() &&
              !msg.reasoning &&
              !msg.error &&
              (!msg.attachments || msg.attachments.length === 0);
            if (isEmptyAssistant) return null;

            return (
              <React.Fragment key={String(msg.id ?? i)}>
                {showDivider && (
                  <div className="chat-time-divider">
                    {formatChatDividerTime(msg.timestamp)}
                  </div>
                )}
                <div
                  data-msg-idx={i}
                  className={`msg-row ${msg.role}${activeMatchMsgIndex === i ? " chat-msg-match-highlight" : ""}`}
                >
                  {msg.role === "assistant" && msg.streaming && (
                    <div className="msg-author">
                      <span className="pulse-dot" />
                      <span>{visual.label} schreibt…</span>
                    </div>
                  )}
                  <div
                    className="msg-bubble"
                    onTouchStart={(e) => {
                      if (msg.streaming || !msg.content.trim()) return;
                      const clean = stripSecretRequestTag(msg.content) || msg.content;
                      startLongPress(
                        e,
                        msg.role === "user" ? "Du" : visual.label,
                        clean,
                        msg.role
                      );
                    }}
                    onTouchMove={moveLongPress}
                    onTouchEnd={cancelLongPress}
                    onTouchCancel={cancelLongPress}
                    onContextMenu={(e) => {
                      if (msg.streaming || !msg.content.trim()) return;
                      e.preventDefault();
                      const clean = stripSecretRequestTag(msg.content) || msg.content;
                      setContextMsg({
                        author: msg.role === "user" ? "Du" : visual.label,
                        text: clean,
                        role: msg.role,
                      });
                    }}
                  >
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="msg-attachments">
                        {msg.attachments.map((att, attIdx) =>
                          att.isImage && att.previewUrl ? (
                            <img
                              key={attIdx}
                              src={att.previewUrl}
                              alt={att.name}
                              className="msg-attachment-img"
                            />
                          ) : (
                            <span key={attIdx} className="msg-attachment-file">
                              <FileText size={14} />
                              {att.name}
                            </span>
                          )
                        )}
                      </div>
                    )}
                    {msg.role === "tool" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                        <Wrench size={13} />
                        <span>{msg.tool_name || "Werkzeug"}</span>
                      </div>
                    ) : msg.content ? (
                      <>
                        {stripSecretRequestTag(msg.content) && (
                          <SafeMarkdown text={stripSecretRequestTag(msg.content)} />
                        )}
                        {(msg.role === "assistant" || msg.role === "user") &&
                          extractPocketPages(msg.content).map((page) => (
                            <PocketPageCard
                              key={page.id}
                              page={page}
                              onOpen={setOpenPocketPage}
                            />
                          ))}
                        {(msg.role === "assistant" || msg.role === "user") &&
                          extractPackageCards(msg.content).map((pkg, pIdx) => (
                            <PackageTrackingCard
                              key={`${pkg.shop}-${pkg.trackingNumber || pkg.orderNumber || pIdx}`}
                              pkg={pkg}
                            />
                          ))}
                        {(msg.role === "assistant" || msg.role === "user") &&
                          extractChecklists(msg.content).map((cl) => (
                            <InteractiveChecklistCard
                              key={cl.id}
                              checklist={cl}
                              onSendStatus={(summary) => {
                                setInput(summary);
                                requestAnimationFrame(() => {
                                  if (textareaRef.current) {
                                    textareaRef.current.focus();
                                    autoResizeInput(textareaRef.current);
                                  }
                                });
                              }}
                            />
                          ))}
                        {msg.role === "assistant" &&
                          (() => {
                            const deals = extractProductDeals(msg.content);
                            if (deals.length === 0) return null;
                            return (
                              <div
                                className={`deal-carousel ${deals.length === 1 ? "single" : ""}`}
                                aria-label="Gefundene Angebote"
                              >
                                {deals.map((deal, dIdx) => (
                                  <ProductDealCard
                                    key={`${deal.shop}-${deal.title}-${dIdx}`}
                                    deal={deal}
                                    disabled={isStreaming || wsState !== "connected"}
                                    onBuy={(picked: DetectedDealCard) => {
                                      const sid = activeSessionRef.current;
                                      if (!sid || wsState !== "connected" || isStreaming) return;
                                      const buyText = picked.url
                                        ? `Bitte bestelle ${picked.title} bei ${picked.shop} für ${picked.price} (${picked.url}) und bereite alles bis zur finalen Bestellübersicht vor.`
                                        : `Bitte bestelle ${picked.title} bei ${picked.shop} für ${picked.price} und bereite alles bis zur finalen Bestellübersicht vor.`;
                                      setMessages((prev) => [
                                        ...prev,
                                        {
                                          id: `u-buy-${Date.now()}`,
                                          role: "user",
                                          content: buyText,
                                          timestamp: Date.now(),
                                        },
                                      ]);
                                      setIsStreaming(true);
                                      scrollToBottomWithSettle();
                                      void hermesWs
                                        .call("prompt.submit", {
                                          session_id: sid,
                                          profile: profile.name,
                                          submission_id: randomClientId("sub"),
                                          text: buyText,
                                          ...(activeModelOverride ? { model_override: activeModelOverride } : {}),
                                        })
                                        .catch(() => setIsStreaming(false));
                                    }}
                                  />
                                ))}
                              </div>
                            );
                          })()}
                      </>
                    ) : msg.streaming ? (
                      <span style={{ color: "var(--text-muted)" }}>…</span>
                    ) : null}
                    {msg.error && (
                      <div style={{ marginTop: 8, color: "var(--status-err)", fontSize: "0.82rem" }}>
                        Fehler: {msg.error}
                      </div>
                    )}
                  </div>
                  {msg.role === "assistant" && !msg.streaming && msg.content.trim() && (
                    <div className="msg-actions-row">
                      <button
                        type="button"
                        className="msg-action-btn"
                        aria-label="Auf Nachricht antworten"
                        onClick={() => {
                          const clean = (stripSecretRequestTag(msg.content) || msg.content)
                            .replace(/\s+/g, " ")
                            .trim();
                          setReplyTo({
                            author: visual.label,
                            excerpt: clean.length > 140 ? `${clean.slice(0, 140)}…` : clean,
                          });
                          requestAnimationFrame(() => textareaRef.current?.focus());
                        }}
                      >
                        <Reply size={12} /> Antworten
                      </button>
                      <button
                        type="button"
                        className="msg-action-btn"
                        aria-label="Nachricht kopieren"
                        onClick={() => {
                          const clean = stripSecretRequestTag(msg.content) || msg.content;
                          const key = String(msg.id ?? i);
                          void navigator.clipboard?.writeText(clean).then(() => {
                            setCopiedMsgKey(key);
                            window.setTimeout(() => {
                              setCopiedMsgKey((cur) => (cur === key ? null : cur));
                            }, 1600);
                          });
                        }}
                      >
                        {copiedMsgKey === String(msg.id ?? i) ? (
                          <>
                            <Check size={12} /> Kopiert
                          </>
                        ) : (
                          <>
                            <Copy size={12} /> Kopieren
                          </>
                        )}
                      </button>
                      {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                        <button
                          type="button"
                          className="msg-action-btn"
                          aria-label="Nachricht teilen"
                          onClick={() => {
                            const clean = stripSecretRequestTag(msg.content) || msg.content;
                            void navigator
                              .share({ title: visual.label, text: clean })
                              .catch(() => undefined);
                          }}
                        >
                          <Share2 size={12} /> Teilen
                        </button>
                      )}
                      {!isPrivateBot && teammates.length > 0 && onForwardToBot && (
                        <button
                          type="button"
                          className="msg-action-btn"
                          aria-label="An anderen Bot weiterleiten"
                          onClick={() => {
                            const clean = msg.content.trim();
                            setForwardText(`Weitergeleitet von ${visual.label}:\n\n${clean}`);
                          }}
                        >
                          <Forward size={12} /> An Bot
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}

        {(activeTool || liveStatus) && (
          <div style={{ alignSelf: "flex-start" }}>
            <span className="pill accent">
              <Wrench size={13} />
              {activeTool ? `${activeTool}…` : liveStatus}
            </span>
          </div>
        )}

        {pendingConnection && activeSessionId && pendingConnection.targets.length > 0 && (
          <InChatConnectionCard
            profileName={profile.name}
            sessionId={activeSessionId}
            request={pendingConnection}
            onUpdated={setPendingConnection}
          />
        )}

        {pendingClarify && (
          <ClarifyPromptCard
            request={pendingClarify}
            botLabel={visual.label}
            onSubmit={handleClarifySubmit}
          />
        )}

        {pendingApproval && (
          <ApprovalPromptCard
            approval={pendingApproval}
            botLabel={visual.label}
            onDecide={handleApprovalDecision}
          />
        )}

        {pendingSecret && (
          <SecretPromptCard
            request={pendingSecret}
            botLabel={visual.label}
            onSubmit={handleSecretSubmit}
            onCancel={handleSecretCancel}
          />
        )}

        {pendingVaultForm && (
          <VaultFormCard
            profileName={profile.name}
            botLabel={visual.label}
            allPublicProfileNames={allProfileNames}
            isPrivateBot={isPrivateBot}
            request={pendingVaultForm}
            onSaved={(safeLabel, kind) => {
              setPendingVaultForm(null);
              const kindName =
                kind === "payment"
                  ? "Zahlungskarte"
                  : kind === "address"
                    ? "Lieferadresse"
                    : "Shop-Login";
              appendSystemNotice(
                `Tresor · ${kindName} (${safeLabel}) verschlüsselt gespeichert – ${visual.label} macht weiter…`
              );
              const sid = activeSessionRef.current;
              if (sid && wsState === "connected") {
                const handoffText =
                  `Ich habe ${kindName} (${safeLabel}) soeben verschlüsselt im Hermes-Tresor gespeichert. ` +
                  `Bitte rufe \`browser_vault\` mit \`action="list"\` auf, fülle das Formular direkt per \`browser_vault(action="fill")\` aus und mache weiter.`;
                setIsStreaming(true);
                void hermesWs
                  .call("prompt.submit", {
                    session_id: sid,
                    profile: profile.name,
                    submission_id: randomClientId("sub"),
                    text: handoffText,
                    ...(activeModelOverride ? { model_override: activeModelOverride } : {}),
                  })
                  .catch(() => {
                    setIsStreaming(false);
                  });
              }
            }}
            onClose={() => setPendingVaultForm(null)}
          />
        )}

        {manualSecret.open && (
          <ManualSecretCard
            key={
              manualSecret.fields?.map((f) => f.keyName).join(",") ||
              manualSecret.initialKey ||
              "manual-secret"
            }
            profileName={profile.name}
            botLabel={visual.label}
            formTitle={manualSecret.formTitle}
            initialKey={manualSecret.initialKey}
            promptText={manualSecret.promptText}
            fields={manualSecret.fields}
            onSaved={(savedKeys, envPathHint) => {
              setManualSecret({ open: false, initialKey: "" });
              const envPath =
                envPathHint ||
                (profile.name === "default"
                  ? "~/.hermes/.env"
                  : `~/.hermes/profiles/${profile.name}/.env`);
              const keysSummary = savedKeys.join(", ");
              appendSystemNotice(
                savedKeys.length > 1
                  ? `Gesichertes Formular (${keysSummary}) in ${envPath} gespeichert – ${visual.label} wird informiert…`
                  : `Schlüssel „${keysSummary}“ sicher in ${envPath} gespeichert – ${visual.label} wird informiert…`
              );
              // Automatically notify the bot of the exact variable names & .env path (NEVER secret values!)
              const sid = activeSessionRef.current;
              if (sid && wsState === "connected") {
                const formattedKeys = savedKeys.map((k) => `\`${k}\``).join(", ");
                const handoffText =
                  savedKeys.length > 1
                    ? `Ich habe das gesicherte Formular soeben vollständig in deiner Profil-.env hinterlegt ` +
                      `(Schlüssel: ${formattedKeys}, Datei: \`${envPath}\`, auch als Umgebungsvariablen freigegeben). ` +
                      `Bitte lies die benötigten Werte direkt aus \`${envPath}\` bzw. der Umgebung aus und mache direkt weiter – gib sensible Werte dabei niemals im Chat aus.`
                    : `Ich habe den geheimen Wert für ${formattedKeys} soeben sicher in deiner Profil-.env hinterlegt ` +
                      `(Schlüssel: ${formattedKeys}, Datei: \`${envPath}\`, auch für \`$${savedKeys[0]}\` freigegeben). ` +
                      `Bitte lies ${formattedKeys} direkt aus \`${envPath}\` bzw. der Umgebungsvariable aus und mache direkt weiter – gib den Klartextwert dabei niemals im Chat aus.`;
                setIsStreaming(true);
                void hermesWs
                  .call("prompt.submit", {
                    session_id: sid,
                    profile: profile.name,
                    submission_id: randomClientId("sub"),
                    text: handoffText,
                    ...(activeModelOverride ? { model_override: activeModelOverride } : {}),
                  })
                  .catch(() => {
                    setIsStreaming(false);
                  });
              }
            }}
            onClose={() => setManualSecret({ open: false, initialKey: "" })}
          />
        )}

        {usageLimitError && (
          <UsageLimitCard
            limitError={usageLimitError}
            fallbackTarget={primaryFallback}
            switching={switchingFallback}
            onSwitchToFallback={() => void handleQuickSwitchToFallback()}
            onOpenModelPicker={() => setModelPickerState({ open: true, search: "", provider: "" })}
            onDismiss={() => setUsageLimitError(null)}
          />
        )}
      </div>

      <div className="composer-wrap">
        {hasNewBelow && (
          <div className="new-msg-scroll-wrap">
            <button
              type="button"
              className="new-msg-scroll-pill"
              onClick={scrollToBottom}
            >
              <ArrowDown size={14} />
              <span>Neue Nachricht</span>
            </button>
          </div>
        )}
        <button
          type="button"
          className={`chat-limit-bar ${limitSummary.severity === "normal" ? "" : limitSummary.severity}`}
          onClick={() => {
            void refreshAccountUsage(activeSessionId);
            setShowLimitSheet(true);
          }}
        >
          <span className="chat-limit-left">
            <Gauge size={13} style={{ flexShrink: 0 }} />
            <span className="chat-limit-text">
              {limitSummary.mode === "remaining" && limitSummary.remainingPercent !== null
                ? `${formatCompactWindowLabel(limitSummary.label)}: ${limitSummary.remainingPercent}% frei`
                : limitSummary.mode === "context" && limitSummary.usedPercent !== null
                  ? `Kontext ${limitSummary.usedPercent}%`
                  : `${currentActiveModel}`}
            </span>
            {limitSummary.barPercent !== null && (
              <span className="chat-limit-meter" aria-hidden="true">
                <span
                  className={`chat-limit-meter-fill ${limitSummary.severity === "normal" ? "" : limitSummary.severity}`}
                  style={{ width: `${limitSummary.barPercent}%` }}
                />
              </span>
            )}
          </span>
          <span className="chat-limit-right">
            {usage.contextPercent !== null && limitSummary.mode !== "context" && (
              <span>Kontext {usage.contextPercent}%</span>
            )}
            {hasAnthropicFallback && (
              <span className="chat-limit-fallback-dot" title="Anthropic-Fallback aktiv">
                <ShieldCheck size={11} />
                Fallback
              </span>
            )}
            <ChevronRight size={13} />
          </span>
        </button>

        {attachments.length > 0 && (
          <div className="attachment-tray">
            {attachments.map((att) => (
              <div key={att.id} className="attachment-chip">
                {att.isImage && att.previewUrl ? (
                  <img
                    src={att.previewUrl}
                    alt={att.file.name}
                    className="attachment-chip-thumb"
                  />
                ) : (
                  <FileText size={16} style={{ flexShrink: 0, color: "var(--accent-indigo)" }} />
                )}
                <span className="attachment-chip-name">{att.file.name}</span>
                <button
                  type="button"
                  className="attachment-chip-remove"
                  aria-label="Anhang entfernen"
                  onClick={() => removeAttachment(att.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!isStreaming && (botQuickPrompts.length > 0 || !input.trim()) && (
          <div className="quick-prompts-bar" aria-label="Schnell-Aktionen">
            {botQuickPrompts.map((qp, idx) => (
              <button
                key={`${qp.label}-${idx}`}
                type="button"
                className="quick-prompt-chip"
                onClick={() => {
                  setInput(qp.prompt);
                  requestAnimationFrame(() => {
                    if (textareaRef.current) {
                      textareaRef.current.focus();
                      autoResizeInput(textareaRef.current);
                    }
                  });
                }}
              >
                {qp.label}
              </button>
            ))}
            <button
              type="button"
              className="quick-prompt-chip"
              aria-label="Schnell-Aktion hinzufügen"
              onClick={() => setShowQuickPromptEditor(true)}
            >
              <Plus size={12} /> {botQuickPrompts.length === 0 ? "Schnell-Aktion" : ""}
            </button>
          </div>
        )}

        {replyTo && (
          <div className="reply-preview-bar" role="status">
            <Reply size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <div className="reply-preview-text">
              <span className="reply-preview-author">{replyTo.author}</span>
              <span className="reply-preview-excerpt">{replyTo.excerpt}</span>
            </div>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label="Zitat entfernen"
              onClick={() => setReplyTo(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}

        <div className="composer-box">
          <button
            type="button"
            className="composer-plus-btn"
            aria-label="Anhang oder Aktionen"
            onClick={() => setShowActionsSheet(true)}
          >
            <Plus size={19} />
          </button>
          <textarea
            ref={textareaRef}
            className="composer-input"
            rows={1}
            enterKeyHint="send"
            value={input}
            onFocus={scrollToBottomWithSettle}
            onChange={(e) => {
              setInput(e.target.value);
              autoResizeInput(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!uploadingAttachments) void handleSend();
              }
            }}
            placeholder={
              voiceActive === "recording"
                ? "Sprich jetzt… (Mikrofon zum Beenden tippen)"
                : voiceActive === "transcribing"
                  ? "Transkribiere…"
                  : uploadingAttachments
                    ? "Lade Anhang hoch…"
                    : `${visual.label} fragen`
            }
          />
          <button
            type="button"
            className={`composer-mic-btn${voiceActive === "recording" ? " recording" : ""}`}
            disabled={voiceActive === "transcribing"}
            aria-label={voiceActive === "recording" ? "Aufnahme beenden" : "Spracheingabe starten"}
            onClick={() => void handleToggleVoice()}
          >
            <Mic size={17} />
          </button>
          {isStreaming && !input.trim() && attachments.length === 0 ? (
            <button
              type="button"
              className="send-btn stop"
              aria-label="Antwort stoppen"
              onClick={() => void handleInterrupt()}
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              aria-label="Nachricht senden"
              disabled={
                uploadingAttachments ||
                (!input.trim() && attachments.length === 0) ||
                wsState !== "connected"
              }
              onClick={() => void handleSend()}
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      <PocketPageViewer
        page={openPocketPage}
        onClose={() => setOpenPocketPage(null)}
      />

      <BotMediaGallerySheet
        open={showMediaGallery}
        profileName={profile.name}
        botLabel={visual.label}
        onClose={() => setShowMediaGallery(false)}
      />

      <Sheet open={Boolean(contextMsg)} onClose={() => setContextMsg(null)}>
        {contextMsg && (
          <>
            <div className="sheet-header">
              <h2 className="sheet-title">{contextMsg.author}</h2>
              <button
                type="button"
                className="icon-btn ghost"
                aria-label="Schließen"
                onClick={() => setContextMsg(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div
              className="card"
              style={{
                marginBottom: 12,
                fontSize: "0.84rem",
                color: "var(--text-secondary)",
                maxHeight: 96,
                overflow: "hidden",
              }}
            >
              {contextMsg.text.slice(0, 220)}
              {contextMsg.text.length > 220 ? "…" : ""}
            </div>
            <div className="card-stack">
              <button
                type="button"
                className="btn primary full"
                onClick={() => {
                  const flat = contextMsg.text.replace(/\s+/g, " ").trim();
                  setReplyTo({
                    author: contextMsg.author,
                    excerpt: flat.length > 140 ? `${flat.slice(0, 140)}…` : flat,
                  });
                  setContextMsg(null);
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
              >
                <Reply size={16} /> Antworten
              </button>
              <button
                type="button"
                className="btn full"
                onClick={() => {
                  void navigator.clipboard?.writeText(contextMsg.text);
                  setContextMsg(null);
                }}
              >
                <Copy size={16} /> Kopieren
              </button>
              {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                <button
                  type="button"
                  className="btn full"
                  onClick={() => {
                    const txt = contextMsg.text;
                    const auth = contextMsg.author;
                    setContextMsg(null);
                    void navigator.share({ title: auth, text: txt }).catch(() => undefined);
                  }}
                >
                  <Share2 size={16} /> Teilen
                </button>
              )}
              {!isPrivateBot && teammates.length > 0 && onForwardToBot && (
                <button
                  type="button"
                  className="btn full"
                  onClick={() => {
                    const txt = contextMsg.text;
                    const auth = contextMsg.author;
                    setContextMsg(null);
                    setForwardText(`Weitergeleitet von ${auth}:\n\n${txt}`);
                  }}
                >
                  <Forward size={16} /> An anderen Bot weiterleiten
                </button>
              )}
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={showQuickPromptEditor} onClose={() => setShowQuickPromptEditor(false)}>
        <div className="sheet-header">
          <h2 className="sheet-title">Schnell-Aktionen · {visual.label}</h2>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Schließen"
            onClick={() => setShowQuickPromptEditor(false)}
          >
            <X size={20} />
          </button>
        </div>

        {botQuickPrompts.length > 0 && (
          <div className="card-stack" style={{ marginBottom: 14 }}>
            {botQuickPrompts.map((qp, idx) => (
              <div
                key={`${qp.label}-${idx}`}
                className="card"
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.86rem" }}>{qp.label}</div>
                  <div
                    style={{
                      fontSize: "0.76rem",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {qp.prompt}
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn ghost"
                  aria-label={`${qp.label} entfernen`}
                  onClick={() => handleRemoveQuickPrompt(idx)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSaveQuickPrompt}>
          <div className="field">
            <label htmlFor="qp-label">Button-Titel (kurz)</label>
            <input
              id="qp-label"
              className="input"
              value={newQuickLabel}
              onChange={(e) => setNewQuickLabel(e.target.value)}
              placeholder="z. B. Tages-Update, Einkaufsliste, Server-Check"
            />
          </div>
          <div className="field">
            <label htmlFor="qp-prompt">Nachricht an {visual.label}</label>
            <textarea
              id="qp-prompt"
              className="textarea"
              value={newQuickPrompt}
              onChange={(e) => setNewQuickPrompt(e.target.value)}
              placeholder="Welche Aufgabe soll beim Antippen eingefügt werden?"
            />
          </div>
          <button
            type="submit"
            className="btn primary full"
            disabled={!newQuickLabel.trim() || !newQuickPrompt.trim()}
          >
            Schnell-Aktion speichern
          </button>
        </form>
      </Sheet>

      <input
        ref={imagePickerRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          handleAddFiles(e.target.files, true);
          e.target.value = "";
        }}
      />
      <input
        ref={filePickerRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          handleAddFiles(e.target.files, false);
          e.target.value = "";
        }}
      />

      <Sheet open={showActionsSheet} onClose={() => setShowActionsSheet(false)}>
        <div className="sheet-header">
          <h2 className="sheet-title">{visual.label}</h2>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Schließen"
            onClick={() => setShowActionsSheet(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="card-stack">
          {teammates.length > 0 && (
            <div className="card" style={{ padding: "11px 12px" }}>
              <div style={{ fontSize: "0.73rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 7 }}>
                Anderen Bot ansprechen (Bot-zu-Bot aktiv)
              </div>
              <div className="chip-row">
                {teammates.map((tm) => (
                  <button
                    key={tm.name}
                    type="button"
                    className="chip"
                    style={{ minHeight: 32, fontSize: "0.78rem" }}
                    onClick={() => {
                      setShowActionsSheet(false);
                      setInput((prev) =>
                        prev.trim() ? `${prev.trim()} ${tm.label} ` : `Frag ${tm.label}: `
                      );
                      requestAnimationFrame(() => textareaRef.current?.focus());
                    }}
                  >
                    {tm.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            className="btn primary full"
            onClick={() => {
              setShowActionsSheet(false);
              imagePickerRef.current?.click();
            }}
          >
            <ImageIcon size={17} /> Foto / Bild senden
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              filePickerRef.current?.click();
            }}
          >
            <Paperclip size={17} /> Datei oder PDF senden
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              setModelPickerState({ open: true, search: "", provider: "" });
            }}
          >
            <Cpu size={17} /> Modell &amp; Anthropic-Fallback (
            {currentActiveModel})
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              void refreshAccountUsage(activeSessionId);
              setShowLimitSheet(true);
            }}
          >
            <Gauge size={17} /> Chat-Limit &amp; Verbrauch
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              setManualSecret({ open: true, initialKey: "" });
              scrollToBottomWithSettle();
            }}
          >
            <KeyRound size={17} /> Passwort / API-Key sicher hinterlegen
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              void startNewChat();
            }}
          >
            <MessageSquarePlus size={17} /> Neuen Chat starten
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              setInChatSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
          >
            <Search size={17} /> Im Chat suchen
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              setShowMediaGallery(true);
            }}
          >
            <ImageIcon size={17} /> Medien &amp; Dateien dieses Bots
          </button>
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              void refreshSessionsList(false);
              setShowSessionsSheet(true);
            }}
          >
            <History size={17} /> Chat-Verlauf ({sessions.length})
          </button>
          {onOpenConnectors && (
            <button
              type="button"
              className="btn full"
              onClick={() => {
                setShowActionsSheet(false);
                onOpenConnectors();
              }}
            >
              <Plug size={17} /> Connectoren &amp; E-Mail
            </button>
          )}
          <button
            type="button"
            className="btn full"
            onClick={() => {
              setShowActionsSheet(false);
              onOpenBotSettings();
            }}
          >
            <Settings2 size={17} /> Bot &amp; Profilbild bearbeiten
          </button>
        </div>
      </Sheet>

      <Sheet open={showSessionsSheet} onClose={() => setShowSessionsSheet(false)}>
        <div className="sheet-header">
          <h2 className="sheet-title">Chats mit {visual.label}</h2>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Schließen"
            onClick={() => setShowSessionsSheet(false)}
          >
            <X size={20} />
          </button>
        </div>

        <button
          type="button"
          className="btn primary full"
          style={{ marginBottom: 12 }}
          onClick={() => void startNewChat()}
        >
          <MessageSquarePlus size={17} /> Neuen Chat starten
        </button>

        {sessions.length === 0 ? (
          <div className="empty-state">
            <p>Noch keine gespeicherten Chats für {visual.label}.</p>
          </div>
        ) : (
          <div className="card-stack">
            {sessions.map((s) => {
              const isCurrent = s.id === activeSessionId;
              return (
                <div
                  key={s.id}
                  className="card"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderColor: isCurrent ? "rgba(255,255,255,0.4)" : undefined,
                  }}
                >
                  <button
                    type="button"
                    style={{ flex: 1, textAlign: "left", minWidth: 0 }}
                    onClick={() => {
                      setShowSessionsSheet(false);
                      void loadSessionHistory(s.id, s.title);
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.title?.trim() || `Chat ${s.id.slice(0, 8)}`}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
                      {s.message_count ? `${s.message_count} Nachrichten` : "Session"}
                      {s.last_active ? ` · ${formatRelativeTime(s.last_active)}` : ""}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="icon-btn ghost"
                    aria-label="Chat löschen"
                    onClick={() => setSessionToDelete(s)}
                  >
                    <Trash2 size={16} style={{ color: "var(--text-muted)" }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Sheet>

      {showLimitSheet && (
        <Suspense fallback={null}>
          <LimitSheet
            open={showLimitSheet}
            botLabel={visual.label}
            usage={usage}
            activeProvider={currentActiveProvider}
            activeModel={currentActiveModel}
            fallbacks={fallbacks}
            loading={loadingAccountUsage}
            onRefresh={() => void refreshAccountUsage(activeSessionId)}
            onOpenModelPicker={() => setModelPickerState({ open: true, search: "", provider: "" })}
            onClose={() => setShowLimitSheet(false)}
          />
        </Suspense>
      )}

      {modelPickerState.open && (
        <Suspense fallback={null}>
          <ModelPickerSheet
            open={modelPickerState.open}
            profileName={profile.name}
            botLabel={visual.label}
            allProfileNames={allProfileNames}
            currentProvider={activeModelOverride?.provider || profile.provider}
            currentModel={activeModelOverride?.model || profile.model}
            initialSearch={modelPickerState.search}
            initialProvider={modelPickerState.provider}
            onSwitched={(prov, mod) => {
              setActiveModelOverride({ provider: prov, model: mod });
              appendSystemNotice(`Modell gewechselt: ${prov} / ${mod}`);
              void onRefreshProfiles();
            }}
            onFallbackChanged={(nextFallbacks) => {
              setFallbacks(nextFallbacks);
            }}
            onClose={() => setModelPickerState((s) => ({ ...s, open: false }))}
          />
        </Suspense>
      )}

      <Sheet open={Boolean(forwardText)} onClose={() => setForwardText(null)}>
        <div className="sheet-header">
          <h2 className="sheet-title">An Bot weiterleiten</h2>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Schließen"
            onClick={() => setForwardText(null)}
          >
            <X size={20} />
          </button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
          Wähle einen Bot – die Nachricht wird in dessen Eingabefeld übernommen, damit du vor dem
          Senden noch etwas ergänzen kannst.
        </p>
        <div className="card-stack">
          {teammates.map((tm) => (
            <button
              key={tm.name}
              type="button"
              className="btn full"
              style={{ justifyContent: "space-between" }}
              onClick={() => {
                if (forwardText && onForwardToBot) {
                  onForwardToBot(tm.name, forwardText);
                }
                setForwardText(null);
              }}
            >
              <span>{tm.label}</span>
              <Forward size={15} style={{ color: "var(--accent-send)" }} />
            </button>
          ))}
        </div>
      </Sheet>

      <ConfirmSheet
        open={Boolean(sessionToDelete)}
        title="Chat wirklich löschen?"
        description={`Die Unterhaltung „${sessionToDelete?.title || sessionToDelete?.id || ""}“ wird dauerhaft aus Hermes entfernt.`}
        confirmLabel="Löschen"
        danger
        busy={deletingSession}
        onCancel={() => setSessionToDelete(null)}
        onConfirm={() => void handleConfirmDeleteSession()}
      />

      {showAvatarLightbox &&
        createPortal(
          <div
            className="avatar-lightbox-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={`Profilbild von ${visual.label}`}
            onClick={() => setShowAvatarLightbox(false)}
          >
            <div
              className="avatar-lightbox-content"
              onClick={(e) => e.stopPropagation()}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={visual.label}
                  className="avatar-lightbox-photo"
                />
              ) : (
                <div
                  className="avatar-lightbox-photo"
                  style={{
                    background: visual.gradient,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "4rem",
                    fontWeight: 800,
                    color: "#090b10",
                  }}
                >
                  {visual.initials}
                </div>
              )}

              <div>
                <div style={{ fontSize: "1.2rem", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {isPrivateBot && <Lock size={15} style={{ color: "var(--status-ok)" }} />}
                  <span>{visual.label}</span>
                </div>
                {profile.description && (
                  <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                    {profile.description}
                  </p>
                )}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setShowAvatarLightbox(false);
                    onOpenBotSettings();
                  }}
                >
                  <Settings2 size={14} /> Bot bearbeiten
                </button>
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => setShowAvatarLightbox(false)}
                >
                  Schließen
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

