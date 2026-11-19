import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageBubble } from "@/components/social/ChatParts";

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function respond(preview: unknown) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ preview }), { status: 200 }));
}

describe("links in a message", () => {
  it("are tappable and open outside the app", () => {
    respond(null);
    renderWithQuery(<MessageBubble isMe={false} first content="read https://example.com/psalm today" />);
    const link = screen.getByRole("link", { name: "https://example.com/psalm" });
    expect(link).toHaveAttribute("href", "https://example.com/psalm");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByText(/read/)).toHaveTextContent("read https://example.com/psalm today");
  });

  it("are tappable in a photo's caption too", () => {
    renderWithQuery(
      <MessageBubble isMe first content="from www.example.com" mediaPath="u/p.jpg" mediaType="photo" />,
    );
    expect(screen.getByRole("link", { name: "www.example.com" })).toHaveAttribute("href", "https://www.example.com/");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/link-preview"), expect.anything());
  });

  it("show the page's preview under the message", async () => {
    respond({
      url: "https://example.com/psalm",
      title: "Psalm 23",
      description: "The Lord is my shepherd",
      siteName: "Example",
      image: "/api/link-preview/image?url=https%3A%2F%2Fexample.com%2Fpsalm",
      largeImage: true,
    });
    renderWithQuery(<MessageBubble isMe={false} first content="https://example.com/psalm" />);

    expect(await screen.findByText("Psalm 23")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/link-preview?url=https%3A%2F%2Fexample.com%2Fpsalm",
      expect.anything(),
    );
    expect(screen.getByText("The Lord is my shepherd")).toBeInTheDocument();
    expect(screen.getByText("Example")).toBeInTheDocument();
    const card = screen.getByText("Psalm 23").closest("a")!;
    expect(card).toHaveAttribute("href", "https://example.com/psalm");
    expect(card.querySelector("img")).toHaveAttribute(
      "src",
      "/api/link-preview/image?url=https%3A%2F%2Fexample.com%2Fpsalm",
    );
  });

  it("name the site by its address when the page doesn't", async () => {
    respond({
      url: "https://www.example.com/x",
      title: "Untitled site",
      description: null,
      siteName: null,
      image: null,
      largeImage: true,
    });
    renderWithQuery(<MessageBubble isMe first content="https://www.example.com/x" />);
    expect(await screen.findByText("example.com")).toBeInTheDocument();
  });

  it("stay plain links when there's no preview", async () => {
    respond(null);
    renderWithQuery(<MessageBubble isMe first content="https://example.com/nothing" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("leave a message without one alone", () => {
    renderWithQuery(<MessageBubble isMe first content="amen" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
