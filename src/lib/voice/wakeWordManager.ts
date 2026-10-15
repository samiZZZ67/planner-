/**
 * NightPlanner Always-Available Wake-Word & Voice Command Manager
 *
 * Implements continuous, lightweight local wake-word listening using Web Speech API,
 * audio chime alerts, permission lifecycle handling, and tab visibility synchronization.
 */

import {
  parseWakeWordAndCommand,
  loadSavedWakeWords,
  STORAGE_KEY_WAKE_ENABLED,
  STORAGE_KEY_WAKE_CHIME,
  STORAGE_KEY_VOICE_REPLIES,
} from './wakeWordMatcher';

export type VoiceAssistantLifecycleState =
  | 'disabled'
  | 'requesting_permission'
  | 'initializing'
  | 'listening_wake_word'
  | 'wake_word_detected'
  | 'listening_command'
  | 'transcribing'
  | 'understanding'
  | 'executing'
  | 'confirming_result'
  | 'speaking_response'
  | 'paused'
  | 'error';

export interface WakeWordManagerOptions {
  onStateChange: (state: VoiceAssistantLifecycleState, statusDetail?: string) => void;
  onWakeWordDetected: (wakeWord: string, immediateCommand?: string) => void;
  onCommandFinalized: (commandText: string) => void;
  onInterimTranscript: (interimText: string) => void;
  onError: (errorMessage: string, isPermissionError?: boolean) => void;
}

export class WakeWordManager {
  private state: VoiceAssistantLifecycleState = 'disabled';
  private recognition: any = null;
  private isEnabled = false;
  private isMuted = false;
  private isTabVisible = true;
  private configuredWakeWords: string[] = [];
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentCommandTranscript = '';
  private options: WakeWordManagerOptions;
  private consecutiveErrors = 0;
  private isProcessingCommand = false;

  constructor(options: WakeWordManagerOptions) {
    this.options = options;
    this.configuredWakeWords = loadSavedWakeWords();

    if (typeof window !== 'undefined') {
      this.initVisibilityListeners();
    }
  }

  public updateWakeWords(words: string[]) {
    this.configuredWakeWords = words;
  }

  public getState(): VoiceAssistantLifecycleState {
    return this.state;
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  private setState(nextState: VoiceAssistantLifecycleState, detail?: string) {
    this.state = nextState;
    this.options.onStateChange(nextState, detail);
  }

  /**
   * Initializes visibilitychange and window focus/blur handlers to pause/resume cleanly.
   */
  private initVisibilityListeners() {
    const handleVisibility = () => {
      this.isTabVisible = document.visibilityState === 'visible';
      if (!this.isEnabled || this.isMuted) return;

      if (this.isTabVisible) {
        if (this.state === 'paused') {
          this.startListening();
        }
      } else {
        // Tab hidden: pause if in wake-word listening state
        if (this.state === 'listening_wake_word') {
          this.stopRecognitionOnly();
          this.setState('paused', 'Tab inactive (paused)');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', () => {
      this.isTabVisible = true;
      if (this.isEnabled && !this.isMuted && this.state === 'paused') {
        this.startListening();
      }
    });
  }

  /**
   * Plays a pleasant, subtle dual-tone chime (520Hz -> 780Hz) to confirm wake-word detection.
   */
  public playWakeChime() {
    if (typeof window === 'undefined') return;
    try {
      const chimeSetting = localStorage.getItem(STORAGE_KEY_WAKE_CHIME);
      if (chimeSetting === 'false') return;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.12); // G5

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {}
  }

  /**
   * Enable wake-word listening (requests permission if needed and starts loop)
   */
  public async enable(): Promise<boolean> {
    this.isEnabled = true;
    this.isMuted = false;
    this.consecutiveErrors = 0;

    try {
      localStorage.setItem(STORAGE_KEY_WAKE_ENABLED, 'true');
    } catch {}

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.setState('error', 'SpeechRecognition is not supported in this browser.');
      this.options.onError('Continuous SpeechRecognition is unavailable in this browser. You can still use push-to-talk.');
      return false;
    }

    return this.startListening();
  }

  /**
   * Disable wake-word listening and release all microphone resources
   */
  public disable() {
    this.isEnabled = false;
    this.clearTimers();
    this.stopRecognitionOnly();
    this.setState('disabled', 'Voice assistant disabled');

    try {
      localStorage.setItem(STORAGE_KEY_WAKE_ENABLED, 'false');
    } catch {}
  }

  /**
   * Toggle mute/unmute
   */
  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted) {
      this.stopRecognitionOnly();
      this.clearTimers();
      this.setState('paused', 'Microphone muted');
    } else if (this.isEnabled) {
      this.startListening();
    }
  }

  /**
   * Transitions state when external action starts or finishes
   */
  public notifyExternalState(state: 'understanding' | 'executing' | 'confirming_result' | 'speaking_response') {
    this.isProcessingCommand = true;
    this.setState(state);
  }

  /**
   * Resets back to continuous wake-word listening after an action completes or speech stops
   */
  public returnToWakeListening(delayMs = 400) {
    this.isProcessingCommand = false;
    this.currentCommandTranscript = '';
    this.clearTimers();

    if (!this.isEnabled || this.isMuted) {
      return;
    }

    if (this.restartTimeout) clearTimeout(this.restartTimeout);
    this.restartTimeout = setTimeout(() => {
      this.startListening();
    }, delayMs);
  }

  /**
   * Start or restart the continuous SpeechRecognition engine
   */
  private startListening(): boolean {
    if (!this.isEnabled || this.isMuted || !this.isTabVisible) {
      return false;
    }

    this.clearTimers();
    this.stopRecognitionOnly();

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.setState('error', 'SpeechRecognition not supported.');
      return false;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        this.consecutiveErrors = 0;
        if (!this.isProcessingCommand) {
          this.setState('listening_wake_word', 'Listening for wake words ("Sami", "Wake up")...');
        }
      };

      recognition.onresult = (event: any) => {
        this.handleSpeechResult(event);
      };

      recognition.onerror = (event: any) => {
        this.handleSpeechError(event);
      };

      recognition.onend = () => {
        this.handleSpeechEnd();
      };

      this.recognition = recognition;
      recognition.start();
      return true;
    } catch (err: any) {
      console.warn('[WakeWordManager] Start error:', err);
      this.handleSpeechError({ error: err?.message || 'start_failed' });
      return false;
    }
  }

  private handleSpeechResult(event: any) {
    let interim = '';
    let final = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += text;
      } else {
        interim += text;
      }
    }

    const currentCombined = (final || interim).trim();
    this.options.onInterimTranscript(currentCombined);

    // 1. In 'listening_wake_word' state: look for wake words
    if (this.state === 'listening_wake_word') {
      const detection = parseWakeWordAndCommand(currentCombined, this.configuredWakeWords);

      if (detection.detected && detection.matchedWakeWord) {
        this.playWakeChime();
        this.setState('wake_word_detected', `Wake word recognized: "${detection.matchedWakeWord}"`);

        // If user spoke a command immediately ("Hey Sami, what tasks do I have left today?"):
        if (detection.hasImmediateCommand) {
          this.options.onWakeWordDetected(detection.matchedWakeWord, detection.commandText);
          this.options.onCommandFinalized(detection.commandText);
        } else {
          // Wake word only ("Hey Sami"): transition to command listening
          this.options.onWakeWordDetected(detection.matchedWakeWord);
          this.setState('listening_command', 'Listening for your command...');
          this.currentCommandTranscript = '';

          // Set silence timeout if no command is given within 8 seconds
          this.resetSilenceTimer(8000);
        }
        return;
      }
    }

    // 2. In 'listening_command' state: collect speech until pause or final
    if (this.state === 'listening_command') {
      if (final) {
        this.currentCommandTranscript = `${this.currentCommandTranscript} ${final}`.trim();
      }

      const activeText = (this.currentCommandTranscript || interim).trim();

      // Reset silence timer on active speech
      this.resetSilenceTimer(1800, () => {
        const command = (this.currentCommandTranscript || interim).trim();
        if (command) {
          this.options.onCommandFinalized(command);
        } else {
          // Revert to wake-word listening if silence
          this.returnToWakeListening();
        }
      });
    }
  }

  private resetSilenceTimer(durationMs: number, onTimeout?: () => void) {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (onTimeout) onTimeout();
      else this.returnToWakeListening();
    }, durationMs);
  }

  private handleSpeechError(event: any) {
    const errorType = event?.error || 'unknown';
    console.warn('[WakeWordManager] Recognition error:', errorType);

    if (errorType === 'not-allowed' || errorType === 'service-not-allowed') {
      this.setState('error', 'Microphone permission denied.');
      this.options.onError('Microphone access was denied. Please allow microphone permissions in your browser.', true);
      this.disable();
      return;
    }

    this.consecutiveErrors++;
    // Backoff if errors persist
    const delay = Math.min(1000 * Math.pow(1.5, this.consecutiveErrors), 5000);

    if (this.isEnabled && !this.isMuted) {
      if (this.restartTimeout) clearTimeout(this.restartTimeout);
      this.restartTimeout = setTimeout(() => {
        this.startListening();
      }, delay);
    }
  }

  private handleSpeechEnd() {
    this.recognition = null;

    // Automatically re-arm continuous listening if enabled and not currently processing
    if (this.isEnabled && !this.isMuted && !this.isProcessingCommand && this.isTabVisible) {
      if (this.restartTimeout) clearTimeout(this.restartTimeout);
      this.restartTimeout = setTimeout(() => {
        this.startListening();
      }, 250);
    }
  }

  private stopRecognitionOnly() {
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {}
      this.recognition = null;
    }
  }

  private clearTimers() {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  public destroy() {
    this.disable();
    this.clearTimers();
  }
}
