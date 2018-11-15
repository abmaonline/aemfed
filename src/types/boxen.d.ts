declare function boxen(input: string, options?: boxen.Options): string;

declare namespace boxen {
  export interface Options {
    align?: "center" | "left" | "right";
    backgroundColor?: string;
    borderColor?: string;
    borderStyle?:
      | "classic"
      | "double"
      | "double-single"
      | "round"
      | "single"
      | "single-double"
      | Styles;
    dimBorder?: boolean;
    float?: "center" | "left" | "right";
    margin?: number | Spacing;
    padding?: number | Spacing;
  }

  export interface Spacing {
    bottom?: number;
    left?: number;
    right?: number;
    top?: number;
  }

  export interface Styles {
    bottomLeft: string;
    bottomRight: string;
    horizontal: string;
    topLeft: string;
    topRight: string;
    vertical: string;
  }
}

export = boxen;
