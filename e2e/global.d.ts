interface Window {
  Haptic?: {
    ask(question: string): void;
    debug: { phase(): string; target(): Element | null };
  };
}
