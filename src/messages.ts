import chalk from "chalk";
import gfs from "graceful-fs";
import path from "path";

export interface IMapping {
  jcrPath: number; // Use < 0 for non existing
  filePath: number;
  line: number;
  column: number;
}

export interface ISourceFileReference {
  jcrPath?: string;
  absoluteFilePath?: string;
  relativeFilePath?: string;
  line?: number;
  column?: number;
}

export function getRef(
  message: string,
  pattern: RegExp,
  jcrContentRoots: string[],
  mapping?: IMapping
): ISourceFileReference | undefined {
  // tslint:disable:object-literal-sort-keys
  // Setup mapping for regex match if needed
  if (!mapping) {
    mapping = {
      jcrPath: 1,
      line: 2,
      column: 3,
      filePath: -1
    };
  }

  // Try to match the message with the pattern
  const match = pattern.exec(message);

  // If there was a match, use mapping to get values from match
  if (match) {
    const ref: ISourceFileReference = {
      jcrPath: mapping.jcrPath >= 0 ? match[mapping.jcrPath] : undefined,
      absoluteFilePath:
        mapping.filePath >= 0 ? match[mapping.filePath] : undefined,
      column:
        mapping.column >= 0 ? parseInt(match[mapping.column], 10) : undefined,
      line: mapping.line >= 0 ? parseInt(match[mapping.line], 10) : undefined
    };
    // tslint:enable:object-literal-sort-keys

    // Try to set filePath based on jcrPath
    setFilePath(ref, jcrContentRoots);

    return ref;
  }
}

export function getLocalSourceLine({
  absoluteFilePath,
  relativeFilePath,
  line,
  column
}: ISourceFileReference) {
  // If filePath is present, continue
  const filePath = relativeFilePath || absoluteFilePath;
  if (filePath) {
    const fragments = [filePath];
    if (line) {
      fragments.push(`${line}`);
      if (column) {
        fragments.push(`${column}`);
      }
    }
    return fragments.join(":");
  }
}

export function formatMessage(ref: ISourceFileReference | undefined) {
  if (ref) {
    const combined = getLocalSourceLine(ref);
    if (combined) {
      return `Local source: ${chalk.blue(combined)}`;
    }
  }
}

export function setFilePath(
  ref: ISourceFileReference,
  jcrContentRoots: string[]
): ISourceFileReference {
  const jcrPath = ref.jcrPath; // store in const, otherwise ts gets confused
  if (jcrPath && !ref.absoluteFilePath) {
    // Try to find the first content root the file exists for
    const jcrContentRoot = jcrContentRoots.find(root => {
      const absolutePath = path.join(root, jcrPath);
      try {
        const stat = gfs.statSync(absolutePath);
        if (!stat.isDirectory()) {
          // Update filePath, maybe do somewhere else
          ref.absoluteFilePath = absolutePath;
          return true;
        }
      } catch (err) {
        // Exception is thrown if file doesn't exist or other problem with file
      }
      return false;
    });
  }
  // Also try to set relative path
  setRelativePath(ref);

  return ref;
}

function setRelativePath(ref: ISourceFileReference): ISourceFileReference {
  // If filePath is present, continue
  if (ref.absoluteFilePath) {
    // Try to make filePath relative to start dir (project)
    // Only if beginning is the same, so no ../ nonsence
    // TODO add option to disable relative if not supported by editor
    const currentDir = path.resolve(".");
    if (ref.absoluteFilePath.startsWith(currentDir)) {
      ref.relativeFilePath = path.relative(currentDir, ref.absoluteFilePath);
    }
  }
  return ref;
}
