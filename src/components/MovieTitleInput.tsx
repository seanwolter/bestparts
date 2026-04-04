"use client";

import { useEffect, useRef, useState } from "react";

interface MovieTitleInputProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

export default function MovieTitleInput({ value, onChange, required }: MovieTitleInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canShowSuggestions = value.trim().length >= 2 && suggestions.length > 0;
  const showSuggestions = open && canShowSuggestions;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tmdb?query=${encodeURIComponent(value)}`);

        if (!res.ok) {
          setSuggestions([]);
          setOpen(false);
          setActiveIndex(-1);
          return;
        }

        const data = await res.json();
        const nextSuggestions = Array.isArray(data) ? data : [];

        setSuggestions(nextSuggestions);
        setOpen(nextSuggestions.length > 0);
        setActiveIndex(-1);
      } catch {
        setSuggestions([]);
        setOpen(false);
        setActiveIndex(-1);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showSuggestions) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      select(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function select(title: string) {
    onChange(title);
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id="movieTitle"
        name="movieTitle"
        type="text"
        required={required}
        placeholder="e.g. The Godfather"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => canShowSuggestions && setOpen(true)}
        autoComplete="off"
        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-white placeholder-neutral-600 focus:outline-none focus:border-yellow-400 transition-colors"
      />
      {showSuggestions && (
        <ul className="absolute z-20 w-full mt-1 bg-neutral-800 border border-neutral-700 rounded-lg overflow-hidden shadow-xl">
          {suggestions.map((title, i) => (
            <li
              key={title}
              onMouseDown={() => select(title)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                i === activeIndex
                  ? "bg-yellow-400 text-neutral-950"
                  : "text-neutral-200 hover:bg-neutral-700"
              }`}
            >
              {title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
