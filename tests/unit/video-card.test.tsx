import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import VideoCard from "@/components/VideoCard";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => (
    <img {...props} />
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/VideoModal", () => ({
  default: () => <div>video modal</div>,
}));

vi.mock("@/components/EditModal", () => ({
  default: () => <div>edit modal</div>,
}));

vi.mock("@/components/UpvoteButton", () => ({
  default: ({
    videoId,
    upvoteCount,
    nextEligibleUpvoteAt,
  }: {
    videoId: number;
    upvoteCount: number;
    nextEligibleUpvoteAt: Date | null;
  }) => {
    const nextEligibleIso = nextEligibleUpvoteAt?.toISOString() ?? "null";

    return (
      <div
        data-testid="upvote-button-props"
        data-video-id={String(videoId)}
        data-next-eligible-upvote-at={nextEligibleIso}
      >
        <button
          type="button"
          aria-label={`Upvote video (${upvoteCount} votes)`}
          disabled={Boolean(nextEligibleUpvoteAt)}
        >
          👍✌️
        </button>
        <span>{upvoteCount}</span>
      </div>
    );
  },
}));

const baseProps = {
  id: 1,
  youtubeId: "abc123def45",
  movieTitle: "Heat",
  sceneTitle: "Downtown shootout",
  description: "Chaos on the street.",
  submittedAt: new Date("2026-04-04T20:00:00.000Z"),
  upvoteCount: 12,
  nextEligibleUpvoteAt: new Date("2026-04-05T20:00:00.000Z"),
};

describe("VideoCard", () => {
  it("hides edit and delete controls for guests", () => {
    render(<VideoCard {...baseProps} canManage={false} />);

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("shows edit and delete controls for authenticated users", () => {
    render(<VideoCard {...baseProps} canManage />);

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("renders the vote count and an available upvote action when the viewer is eligible", () => {
    render(
      <VideoCard
        {...baseProps}
        upvoteCount={7}
        nextEligibleUpvoteAt={null}
        canManage={false}
      />
    );

    expect(screen.getByRole("button", { name: "Upvote video (7 votes)" })).toBeEnabled();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByTestId("upvote-button-props")).toHaveAttribute(
      "data-video-id",
      "1"
    );
    expect(screen.getByTestId("upvote-button-props")).toHaveAttribute(
      "data-next-eligible-upvote-at",
      "null"
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("renders the cooldown vote state separately from manage actions", () => {
    render(<VideoCard {...baseProps} canManage={false} />);

    expect(
      screen.getByRole("button", { name: "Upvote video (12 votes)" })
    ).toBeDisabled();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByTestId("upvote-button-props")).toHaveAttribute(
      "data-next-eligible-upvote-at",
      "2026-04-05T20:00:00.000Z"
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
