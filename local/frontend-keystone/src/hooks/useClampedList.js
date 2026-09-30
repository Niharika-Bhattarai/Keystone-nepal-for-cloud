import { useState } from 'react';
export const useClampedList = (items = [], initialCount = 6) => {
    const safeItems = Array.isArray(items) ? items : [];
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? safeItems : safeItems.slice(0, initialCount);
    const hiddenCount = Math.max(0, safeItems.length - visible.length);
    return { expanded, setExpanded, visible, hiddenCount };
};
