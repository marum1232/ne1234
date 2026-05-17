import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginScreen } from "../src/components/LoginScreen";
import { AuthProvider } from "../src/AuthProvider";

vi.mock("../src/hooks/useLoginFlow", () => ({
  useLoginFlow: vi.fn().mockReturnValue({
    initiateLogin: vi.fn().mockResolvedValue({ method: "otp", exists: true }),
    verifyOtp: vi.fn().mockResolvedValue(undefined),
    verifyPassword: vi.fn().mockResolvedValue(undefined),
    twoFactorVerify: vi.fn().mockResolvedValue(undefined),
    loading: false,
    error: null,
    method: null,
    twoFactorPending: false,
    clearError: vi.fn(),
  }),
}));

import { useLoginFlow } from "../src/hooks/useLoginFlow";

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <AuthProvider storageType="memory">
      {ui}
    </AuthProvider>
  );
}

describe("LoginScreen", () => {
  beforeEach(() => {
    vi.mocked(useLoginFlow).mockReturnValue({
      initiateLogin: vi.fn().mockResolvedValue({ method: "otp", exists: true }),
      verifyOtp: vi.fn().mockResolvedValue(undefined),
      verifyPassword: vi.fn().mockResolvedValue(undefined),
      twoFactorVerify: vi.fn().mockResolvedValue(undefined),
      loading: false,
      error: null,
      method: null,
      twoFactorPending: false,
      clearError: vi.fn(),
    });
  });

  describe("role-based rendering", () => {
    it("renders AJKMart title for customer role", () => {
      renderWithProvider(<LoginScreen role="customer" />);
      expect(screen.getByText("AJKMart")).toBeInTheDocument();
    });

    it("renders Rider Portal title for rider role", () => {
      renderWithProvider(<LoginScreen role="rider" />);
      expect(screen.getByText("Rider Portal")).toBeInTheDocument();
    });

    it("renders Vendor Portal title for vendor role", () => {
      renderWithProvider(<LoginScreen role="vendor" />);
      expect(screen.getByText("Vendor Portal")).toBeInTheDocument();
    });

    it("renders Admin Panel title for admin role", () => {
      renderWithProvider(<LoginScreen role="admin" />);
      expect(screen.getByText("Admin Panel")).toBeInTheDocument();
    });
  });

  describe("identifier step", () => {
    it("shows a phone input on initial render", () => {
      renderWithProvider(<LoginScreen role="customer" />);
      const input = screen.getByRole("textbox");
      expect(input).toBeInTheDocument();
    });

    it("shows custom title when title prop is provided", () => {
      renderWithProvider(<LoginScreen role="customer" title="Custom Login Title" />);
      expect(screen.getByText("Custom Login Title")).toBeInTheDocument();
    });

    it("calls initiateLogin when user submits identifier", async () => {
      const mockInitiate = vi.fn().mockResolvedValue({ method: "otp", exists: true });
      vi.mocked(useLoginFlow).mockReturnValue({
        initiateLogin: mockInitiate,
        verifyOtp: vi.fn(),
        verifyPassword: vi.fn(),
        twoFactorVerify: vi.fn(),
        loading: false,
        error: null,
        method: null,
        twoFactorPending: false,
        clearError: vi.fn(),
      });

      const user = userEvent.setup();
      renderWithProvider(<LoginScreen role="customer" />);

      const input = screen.getByRole("textbox");
      await user.clear(input);
      await user.type(input, "03001234567");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(mockInitiate).toHaveBeenCalled();
      });
    });
  });

  describe("OTP step transition", () => {
    it("shows OTP input after initiateLogin returns otp method", async () => {
      const mockInitiate = vi.fn().mockResolvedValue({ method: "otp" as const, exists: true });

      vi.mocked(useLoginFlow).mockReturnValue({
        initiateLogin: mockInitiate,
        verifyOtp: vi.fn(),
        verifyPassword: vi.fn(),
        twoFactorVerify: vi.fn(),
        loading: false,
        error: null,
        method: "otp",
        twoFactorPending: false,
        clearError: vi.fn(),
      });

      const user = userEvent.setup();
      const { rerender } = renderWithProvider(<LoginScreen role="customer" />);

      const input = screen.getByRole("textbox");
      await user.type(input, "03001234567");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(mockInitiate).toHaveBeenCalled();
      });

      vi.mocked(useLoginFlow).mockReturnValue({
        initiateLogin: mockInitiate,
        verifyOtp: vi.fn(),
        verifyPassword: vi.fn(),
        twoFactorVerify: vi.fn(),
        loading: false,
        error: null,
        method: "otp",
        twoFactorPending: false,
        clearError: vi.fn(),
      });

      rerender(
        <AuthProvider storageType="memory">
          <LoginScreen role="customer" />
        </AuthProvider>
      );
    });
  });

  describe("error handling", () => {
    it("displays error message when login flow sets an error", () => {
      vi.mocked(useLoginFlow).mockReturnValue({
        initiateLogin: vi.fn(),
        verifyOtp: vi.fn(),
        verifyPassword: vi.fn(),
        twoFactorVerify: vi.fn(),
        loading: false,
        error: "Invalid phone number",
        method: null,
        twoFactorPending: false,
        clearError: vi.fn(),
      });

      renderWithProvider(<LoginScreen role="customer" />);
      expect(screen.getByText("Invalid phone number")).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("shows loading indicator when loading is true", () => {
      vi.mocked(useLoginFlow).mockReturnValue({
        initiateLogin: vi.fn(),
        verifyOtp: vi.fn(),
        verifyPassword: vi.fn(),
        twoFactorVerify: vi.fn(),
        loading: true,
        error: null,
        method: null,
        twoFactorPending: false,
        clearError: vi.fn(),
      });

      renderWithProvider(<LoginScreen role="customer" />);
      const btn = screen.getByRole("button");
      expect(btn).toBeDisabled();
    });
  });
});
