"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
  retryKey: number;
}

export class FlowErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      message: null,
      retryKey: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      message: error?.message || "Lỗi hiển thị tạm thời trên màn hình Dòng chảy live",
    };
  }

  componentDidCatch() {
    // Intentionally do not log secrets or sensitive state
  }

  private handleReset = () => {
    this.setState((prev) => ({
      hasError: false,
      message: null,
      retryKey: prev.retryKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-6 text-center"
        >
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h2 className="mt-3 text-sm font-semibold text-slate-100">
            Màn hình Dòng chảy live gặp sự cố hiển thị tạm thời
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {this.state.message}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tải lại màn hình
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600"
            >
              Tải lại toàn trang
            </button>
          </div>
        </div>
      );
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
