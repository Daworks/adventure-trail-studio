import type { Project, Selection } from "../domain/types";

export type EditorHistoryState = {
  future: Project[];
  history: Project[];
  project: Project;
  selected: Selection;
};

export function undoHistory(state: EditorHistoryState): Partial<EditorHistoryState> | undefined {
  const previous = state.history.at(-1);
  if (!previous) return undefined;
  return {
    project: previous,
    history: state.history.slice(0, -1),
    future: [state.project, ...state.future],
    selected: null,
  };
}

export function redoHistory(state: EditorHistoryState): Partial<EditorHistoryState> | undefined {
  const next = state.future[0];
  if (!next) return undefined;
  return {
    project: next,
    history: [...state.history, state.project],
    future: state.future.slice(1),
    selected: null,
  };
}
