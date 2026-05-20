# Single Scroll UX Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate nested scrollbars and viewport scroll chaining in the service configuration and job modals.

**Architecture:** Use React `useEffect` for backdrop scroll-locking and CSS classes for clean single-scroll layouts.

**Tech Stack:** React, CSS, Tailwind

---

### Task 1: Backdrop Scroll Lock in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add useEffect to manage body overflow class**

Add a `useEffect` inside `App` component that locks scrolling on the document body when any configuration or build modal is open.

```typescript
  // Lock body scroll when modals are active
  useEffect(() => {
    const isModalOpen = showAddModal || showAddBatchModal || showBuildForm || terminalBuild !== null || validationResult !== null;
    if (isModalOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [showAddModal, showAddBatchModal, showBuildForm, terminalBuild, validationResult]);
```

- [ ] **Step 2: Add overflow-hidden to App.tsx modal container**

Modify the modal wrapper elements to ensure they don't leak layout boundaries.

In `App.tsx` line 401:
```typescript
            {/* Add Service Modal */}
            {showAddModal && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
                <div className="glass-card w-full max-w-3xl p-8 relative max-h-[90vh] flex flex-col overflow-hidden">
```

In `App.tsx` line 529:
```typescript
            {showAddBatchModal && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-8 z-50">
                <div className="glass-card w-full max-w-2xl p-12 relative border-brand-orange/20 overflow-y-auto max-h-[90vh]">
```

- [ ] **Step 3: Verify no compilation errors**
Check the frontend development logs or run a build.

- [ ] **Step 4: Commit changes**

```bash
git add frontend/src/App.tsx
git commit -m "ux(app): add backdrop scroll lock and modal overflow configuration"
```

---

### Task 2: Layout & Scrollbar Tuning for ProcessConfigForm

**Files:**
- Modify: `frontend/src/components/ProcessConfigForm.tsx`

- [ ] **Step 1: Check and tune scroll container element**

Verify that `ProcessConfigForm.tsx` has its content scrolling container styled cleanly, utilizing the custom scrollbar and sufficient right padding to avoid layout compression.

In `ProcessConfigForm.tsx` line 205:
```typescript
      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto pr-3 space-y-4 min-h-0 custom-scrollbar">
```

- [ ] **Step 2: Verify no compilation errors**
Check logs or run build.

- [ ] **Step 3: Commit changes**

```bash
git add frontend/src/components/ProcessConfigForm.tsx
git commit -m "ux(form): add custom-scrollbar and increase padding to single-scroll controls container"
```
