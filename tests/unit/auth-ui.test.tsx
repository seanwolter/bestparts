import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  browserSupportsWebAuthn: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: mocks.browserSupportsWebAuthn,
  startAuthentication: mocks.startAuthentication,
  startRegistration: mocks.startRegistration,
}));

import LoginForm from "@/components/LoginForm";
import SetupPasskeyForm from "@/components/SetupPasskeyForm";
import LogoutButton from "@/components/LogoutButton";

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("auth UI", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.browserSupportsWebAuthn.mockResolvedValue(true);
    mocks.startAuthentication.mockResolvedValue({
      id: "credential-login",
    });
    mocks.startRegistration.mockResolvedValue({
      id: "credential-setup",
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("submits username-first login and redirects after a verified passkey flow", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          options: {
            challenge: "login-challenge",
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "mark" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Continue with passkey" }).closest("form")!
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "/api/auth/login/options",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    expect(mocks.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: {
        challenge: "login-challenge",
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/login/verify",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(mocks.routerPush).toHaveBeenCalledWith("/");
    expect(mocks.routerRefresh).toHaveBeenCalled();
  });

  it("redirects to the requested next path after login", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          options: {
            challenge: "login-challenge",
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    render(<LoginForm nextPath="/admin/users" />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "mark" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Continue with passkey" }).closest("form")!
    );

    await waitFor(() => {
      expect(mocks.routerPush).toHaveBeenCalledWith("/admin/users");
    });
  });

  it("shows the generic login error when login options fail", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Authentication failed.",
        },
        { status: 400 }
      )
    );

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "mark" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Continue with passkey" }).closest("form")!
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Authentication failed.");
    expect(mocks.startAuthentication).not.toHaveBeenCalled();
  });

  it("shows the expired-or-used setup token error from the setup flow", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Setup token is invalid or expired.",
        },
        { status: 400 }
      )
    );

    render(<SetupPasskeyForm token="bad-token" />);

    fireEvent.click(screen.getByRole("button", { name: "Register passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Setup token is invalid or expired."
    );
    expect(mocks.startRegistration).not.toHaveBeenCalled();
  });

  it("completes passkey setup and redirects home", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          options: {
            challenge: "setup-challenge",
          },
          user: {
            username: "mark",
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    render(<SetupPasskeyForm token="setup-token" />);

    fireEvent.click(screen.getByRole("button", { name: "Register passkey" }));

    await waitFor(() => {
      expect(mocks.startRegistration).toHaveBeenCalledWith({
        optionsJSON: {
          challenge: "setup-challenge",
        },
      });
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/setup/verify",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(mocks.routerPush).toHaveBeenCalledWith("/");
    expect(mocks.routerRefresh).toHaveBeenCalled();
  });

  it("shows a specific add-passkey error when the current device already has a passkey", async () => {
    mocks.startRegistration.mockRejectedValueOnce({
      name: "InvalidStateError",
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        options: {
          challenge: "setup-challenge",
        },
        user: {
          username: "mark",
          reason: "ADD_PASSKEY",
        },
      })
    );

    render(<SetupPasskeyForm token="setup-token" />);

    fireEvent.click(screen.getByRole("button", { name: "Register passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This device or passkey manager already has a passkey for this account."
    );
    expect(screen.getByText("Add another passkey")).toBeInTheDocument();
  });

  it("shows the generic setup error and stays on the setup screen when verification fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          options: {
            challenge: "setup-challenge",
          },
          user: {
            username: "mark",
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "Passkey setup failed.",
          },
          { status: 400 }
        )
      );

    render(<SetupPasskeyForm token="setup-token" />);

    fireEvent.click(screen.getByRole("button", { name: "Register passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Passkey setup failed.");
    expect(screen.getByRole("heading", { name: "Register your passkey" })).toBeInTheDocument();
    expect(mocks.routerPush).not.toHaveBeenCalled();
  });

  it("posts logout and refreshes navigation", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    render(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/logout",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    expect(mocks.routerPush).toHaveBeenCalledWith("/");
    expect(mocks.routerRefresh).toHaveBeenCalled();
  });
});
