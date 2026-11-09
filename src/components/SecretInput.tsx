"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A password box with an eye beside it, for seeing what is actually in it.
 *
 * Every secret on this site goes into one of these: a keeper's passphrase, a
 * house key, an identity key, a token. Hidden, a box cannot tell anybody that
 * a password manager filled in last month's passphrase, or that a phone
 * keyboard did something to the one just chosen, and the town hall's refusal
 * deliberately does not say which half of a sign-in was wrong. The eye is the
 * only way to find out.
 *
 * Shown, it is a text box, and phone keyboards treat a text box as prose: they
 * capitalise the first letter and correct words they do not know. A
 * passphrase chosen that way is not the one typed into a hidden box on the
 * next device, so the box turns all of that off whichever way it is showing.
 *
 * Everything else, including `ref` and the attributes that keep password
 * managers out of a box, passes straight through to the input.
 */
export function SecretInput({
  className,
  what,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  /** What the box holds, for the button's label: "passphrase", "key", "token". */
  what: string;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={shown ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(className, "pr-10")}
      />
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        // Keeps the caret in the box, and the keyboard up on a phone, so
        // somebody can look and carry on typing.
        onMouseDown={(event) => event.preventDefault()}
        aria-label={shown ? `Hide the ${what}` : `Show the ${what}`}
        aria-pressed={shown}
        title={shown ? `Hide the ${what}` : `Show the ${what}`}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-ink-500 hover:text-ink-300 transition-colors"
      >
        {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
