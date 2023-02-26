// to remove warnings
declare const require: Function;
declare const atom: any;
declare const __dirname: any;
declare const module: any;

interface ITriggerPoint {
  location: ITriggerPointLocation;
}

const path = require("path");
const { AutoLanguageClient } = require("atom-languageclient");
const { filter } = require("fuzzaldrin-plus");

interface ITriggerPointLocation {
  arow: number;
  acolumn: number;
}

class TypeScriptLanguageClient extends AutoLanguageClient {
  getGrammarScopes(): string[] {
    return atom.config.get("ide-typescript.javascriptSupport")
      ? ["source.ts", "source.tsx", "source.js", "source.js.jsx"]
      : ["source.ts", "source.tsx"];
  }
  getLanguageName(): string {
    return "TypeScript";
  }
  getServerName(): string {
    return "SourceGraph";
  }

  startServerProcess() {
    const args = [
      "node_modules/javascript-typescript-langserver/lib/language-server-stdio"
    ];
    return super.spawnChildNode(args, { cwd: path.join(__dirname, "..") });
  }

  preInitialization(connection) {
    connection.onCustom("$/partialResult", () => {}); // Suppress partialResult until the language server honors 'streaming' detection
  }

  consumeLinterV2() {
    if (atom.config.get("ide-typescript.diagnosticsEnabled") === true) {
      super.consumeLinterV2.apply(this, arguments);
    }
  }

  deactivate(): Promise<any> {
    return Promise.race([super.deactivate(), this.createTimeoutPromise(2000)]);
  }

  createTimeoutPromise(milliseconds: number) {
    return new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        clearTimeout(timeout);
        this.logger.error(
          `Server failed to shutdown in ${milliseconds}ms, forcing termination`
        );
        resolve();
      }, milliseconds);
    });
  }

  getTriggerPoint(request, triggerChars): ITriggerPointLocation {
    if (triggerChars.includes(request.prefix)) return request.bufferPosition;

    return {
      arow: request.bufferPosition.row,
      acolumn: request.bufferPosition.column - request.prefix.length
    };
  }

  getPrefixWithTrigger(request, triggerPoint) {
    return request.editor
      .getBuffer()
      .getTextInRange([
        [triggerPoint.row, triggerPoint.column - 1],
        request.bufferPosition
      ]);
  }

  async getSuggestions(request): Promise<any[]> {
    const server = await this._serverManager.getServer(request.editor);
    if (server == null) {
      return (server.currentSuggestions = []);
    }

    const triggerChars =
      server.capabilities.completionProvider &&
      server.capabilities.completionProvider.triggerCharacters;
    const triggerPoint = this.getTriggerPoint(request, triggerChars);
    const prefixWithTrigger = this.getPrefixWithTrigger(request, triggerPoint);
    const autoTrigger = triggerChars.find(t => prefixWithTrigger.startsWith(t));

    if (autoTrigger == null && !request.activatedManually) {
      return (server.currentSuggestions = []);
    }

    // TODO: Handle IsComplete with caching
    if (server.currentSuggestions && server.currentSuggestions.length > 0) {
      if (autoTrigger == prefixWithTrigger) {
        // User backspaced to trigger, represent entire cache
        this.setPrefixOnSuggestions(server.currentSuggestions, request.prefix);
        return server.currentSuggestions;
      }
      if (autoTrigger) {
        // Still in a triggered autocomplete with cache, fuzzy-filter those results
        const results = filter(server.currentSuggestions, request.prefix, {
          key: "text"
        });
        this.setPrefixOnSuggestions(server.currentSuggestions, request.prefix);
        return results;
      }
    }

    // We must be triggered but we don't have a cache so send to LSP
    return (server.currentSuggestions = await super.getSuggestions(request));
  }

  setPrefixOnSuggestions(suggestions, prefix) {
    for (const suggestion of suggestions) {
      suggestion.replacementPrefix = prefix;
    }
  }

  onDidConvertAutocomplete(completionItem, suggestion, request) {
    if (suggestion.rightLabel == null || suggestion.displayText == null) return;

    const nameIndex = suggestion.rightLabel.indexOf(suggestion.displayText);
    if (nameIndex >= 0) {
      const signature = suggestion.rightLabel
        .substr(nameIndex + suggestion.displayText.length)
        .trim();
      let paramsStart = -1;
      let paramsEnd = -1;
      let returnStart = -1;
      let bracesDepth = 0;
      for (let i = 0; i < signature.length; i++) {
        switch (signature[i]) {
          case "(": {
            if (bracesDepth++ === 0 && paramsStart === -1) {
              paramsStart = i;
            }
            break;
          }
          case ")": {
            if (--bracesDepth === 0 && paramsEnd === -1) {
              paramsEnd = i;
            }
            break;
          }
          case ":": {
            if (returnStart === -1 && bracesDepth === 0) {
              returnStart = i;
            }
            break;
          }
        }
      }
      if (
        atom.config.get("ide-typescript.returnTypeInAutocomplete") === "left"
      ) {
        if (paramsStart > -1) {
          suggestion.rightLabel = signature
            .substring(paramsStart, paramsEnd + 1)
            .trim();
        }
        if (returnStart > -1) {
          suggestion.leftLabel = signature.substring(returnStart + 1).trim();
        }
      } else {
        suggestion.rightLabel = signature.substring(paramsStart).trim();
        suggestion.leftLabel = "";
      }
    }
  }
}

module.exports = new TypeScriptLanguageClient();
