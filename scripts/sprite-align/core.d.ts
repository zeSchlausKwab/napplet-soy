export type Point = { x: number; y: number };
export type Frame = Point & { width: number; height: number };
export type Source = { name: string; width: number; height: number; sha256: string };
export type Grid = { columns: number; rows: number };
export type Plan = {
  width: number;
  height: number;
  paddingX: number;
  paddingY: number;
  offsets: Point[];
  target: Point | null;
};
export type Recipe = {
  schema: string;
  source: Source;
  grid: Grid;
  anchors: Point[];
  output: {
    cellWidth: number;
    cellHeight: number;
    width: number;
    height: number;
    paddingX: number;
    paddingY: number;
    offsets: Point[];
    anchor: Point | null;
    order: string;
    transform: string;
  };
};
export function splitGrid(width: number, height: number, columns: number, rows: number): Frame[];
export function alignmentPlan(
  frames: Frame[],
  anchors: (Point | null)[],
  allowPartial?: boolean,
): Plan;
export function makeRecipe(source: Source, grid: Grid, anchors: (Point | null)[]): Recipe;
export function validateRecipe(recipe: unknown, source: Source): Recipe;
