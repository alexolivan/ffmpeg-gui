# Design Spec: Single Scroll UX Improvement for Service Configuration

## Goal
Improve the user experience (UX) when configuring services by eliminating nested scrollbars and scroll chaining (background scrolling) while the modal is open.

## Scope
1. Prevent the main dashboard background from scrolling when any configuration modal is open.
2. Ensure the configuration form has a single, cohesive scrollbar for the dynamic fields while maintaining the header, tabs, and action buttons fixed.
3. Verify that child component panels do not specify overflow properties that might introduce nested scrolls.

## Proposed Design

### 1. Backdrop Scroll Lock (`App.tsx`)
We will implement a custom React hook or a simple `useEffect` in `App.tsx` that monitors modal states (`showAddModal`, `showAddBatchModal`, `showBuildForm`). When any of these are active, we inject `overflow-hidden` into `document.body` to prevent viewport-level scrolling.

### 2. Streamlining `ProcessConfigForm.tsx` Scrolling
- The container of the form retains `flex flex-col h-full max-h-[75vh]`.
- The content container `<div className="flex-1 overflow-y-auto pr-1 space-y-4 min-h-0">` acts as the single scrolling region for all form controls of the active tab.
- We will add `overflow-hidden` to the modal card container (`glass-card`) in `App.tsx` to prevent child overflow from causing secondary scrollbars or layout breakage.

### 3. Verification of Child Panels
We will review:
- `InputSourcePanel.tsx`
- `VideoCodecPanel.tsx`
- `AudioCodecPanel.tsx`
- `DestinationPanel.tsx`
- `BatchJobForm.tsx`
to ensure none of them use `overflow-y-auto` or `max-h` properties that could trigger secondary internal scrolls.
