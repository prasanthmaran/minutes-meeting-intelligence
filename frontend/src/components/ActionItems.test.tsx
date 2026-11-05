import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActionItems } from "./ActionItems";

afterEach(cleanup);

const items = [
  {
    text: "Send pilot order draft",
    owner: "Jordan Hale",
    deadline: "Friday 6 November",
    source_ids: ["s1"],
  },
  { text: "Flag legal on MSA", owner: null, deadline: null, source_ids: [] },
];
const sources = [{ id: "s1", start: 460, end: 470, text: "..." }];

it("shows compact owner, deadline and evidence with integration buttons", () => {
  const onSource = vi.fn();
  render(<ActionItems items={items} sources={sources} emptyText="none" onSource={onSource} />);
  const [first, second] = screen.getAllByRole("listitem");
  expect(within(first).getByText("Jordan Hale")).toBeInTheDocument();
  expect(within(first).getByText("Friday 6 November")).toBeInTheDocument();
  expect(within(second).getByText("Owner not specified")).toHaveClass("unspecified");
  fireEvent.click(within(first).getByRole("button", { name: "Show evidence at 07:40" }));
  expect(onSource).toHaveBeenCalledWith("s1");
  for (const name of ["Add to calendar", "Send email", "Create Jira task", "Create pull request"])
    expect(
      within(first).getByRole("button", { name: `${name} (coming soon)` })
    ).toBeInTheDocument();
});

it("explains that integrations are coming soon without sending anything", () => {
  render(<ActionItems items={items} sources={sources} emptyText="none" onSource={vi.fn()} />);
  const first = screen.getAllByRole("listitem")[0];
  fireEvent.click(within(first).getByRole("button", { name: "Create Jira task (coming soon)" }));
  const toast = screen.getByRole("status");
  expect(toast).toHaveTextContent("Create Jira task is coming soon");
  expect(toast).toHaveTextContent("assigned to Jordan Hale");
  expect(toast).toHaveTextContent("Proof of concept: nothing was sent.");
  fireEvent.click(within(toast).getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
