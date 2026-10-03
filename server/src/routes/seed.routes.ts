import { Router, Request, Response, NextFunction } from 'express';
import { Subject } from '../models/Subject.js';
import { Topic } from '../models/Topic.js';
import { ConceptLab } from '../models/ConceptLab.js';
import { authMiddleware } from '../middlewares/auth.js';

export const seedRouter = Router();

seedRouter.use(authMiddleware);

seedRouter.post('/starter-data', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    // Check if user already has subjects
    const existing = await Subject.findOne({ userId });
    if (existing) {
      return res.json({ success: true, message: 'User already has data. Skipping seed.' });
    }

    // 1. Create Core Subjects
    const dsa = await Subject.create({
      userId,
      name: 'Data Structures & Algorithms',
      description: 'Core algorithmic paradigms, time/space optimization, and problem patterns.',
      color: '#C25E3E', // Muted terracotta
      icon: 'Binary',
      order: 0,
    });

    const sysDesign = await Subject.create({
      userId,
      name: 'System Design & Architecture',
      description: 'Distributed systems, caching, consistency models, and high-scale backends.',
      color: '#4D7C0F', // Muted sage/olive
      icon: 'Layers',
      order: 1,
    });

    const webDev = await Subject.create({
      userId,
      name: 'Full Stack Development',
      description: 'Modern TypeScript, React architecture, database modeling, and security.',
      color: '#D97706', // Warm amber
      icon: 'Code',
      order: 2,
    });

    // 2. Create Representative Topics for DSA
    const binarySearch = await Topic.create({
      userId,
      subjectId: dsa._id,
      name: 'Binary Search & Monotonic Space',
      slug: 'binary-search-monotonic-space',
      lifecycleStatus: 'RETAINED',
      masteryScore: 82,
      comprehensionScore: 88,
      applicationScore: 80,
      retentionScore: 85,
      consistencyScore: 75,
      stabilityDays: 6.5,
      totalStudyMinutes: 145,
      revisionCycleCount: 2,
      nextRevisionDueDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
    });

    await ConceptLab.create({
      userId,
      topicId: binarySearch._id,
      intuition: `### The Essence of Binary Search\n\nBinary Search is **not** merely about searching an already sorted array. Its true mathematical power lies in **predicate monotonicity**.\n\nWhenever you have a predicate function $P(x) \\to \\{\\text{False}, \\dots, \\text{False}, \\text{True}, \\dots, \\text{True}\\}$, binary search locates the exact inflection point in $\\mathcal{O}(\\log N)$ time.\n\n#### Key Invariant:\n- Maintain active search space $[\\text{low}, \\text{high}]$ such that the target is guaranteed to lie within boundaries.\n- Shrink space decisively on each step without discarding potential valid answers.`,
      complexity: {
        time: 'O(log N)',
        space: 'O(1) auxiliary',
        explanation: 'Halves the search space on every iteration; requires constant pointer variables.',
      },
      codeSnippets: [
        {
          language: 'python',
          title: 'Canonical Monotonic Binary Search',
          code: `def binary_search(nums: list[int], target: int) -> int:
    low, high = 0, len(nums) - 1
    while low <= high:
        mid = low + (high - low) // 2
        if nums[mid] == target:
            return mid
        elif nums[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1`,
        },
      ],
      personalNotes: `*Remember:*\n1. Use \`low + (high - low) // 2\` to avoid potential 32-bit integer overflow in languages like C++/Java.\n2. When looking for lower bound (\`first True\`), set \`high = mid\` when condition is met!`,
      tags: ['Binary Search', 'Divide and Conquer', 'Monotonicity', 'Array'],
    });

    const slidingWindow = await Topic.create({
      userId,
      subjectId: dsa._id,
      name: 'Sliding Window & Two Pointers',
      slug: 'sliding-window-two-pointers',
      lifecycleStatus: 'LEARNING',
      masteryScore: 48,
      comprehensionScore: 65,
      applicationScore: 50,
      retentionScore: 40,
      consistencyScore: 35,
      stabilityDays: 2.0,
      totalStudyMinutes: 50,
      revisionCycleCount: 0,
    });

    await ConceptLab.create({
      userId,
      topicId: slidingWindow._id,
      intuition: `### Dynamic Window Optimization\n\nConvert an $\\mathcal{O}(N^2)$ brute-force sub-array evaluation into an amortized $\\mathcal{O}(N)$ linear pass by maintaining state transitions across a moving boundary $[L, R]$.`,
      complexity: {
        time: 'O(N) Amortized',
        space: 'O(K) where K is unique character count',
        explanation: 'Each pointer (L, R) visits each index at most once.',
      },
      codeSnippets: [
        {
          language: 'python',
          title: 'Variable Window Template',
          code: `def longest_valid_window(s: str) -> int:
    left = 0
    max_len = 0
    counts = {}
    for right in range(len(s)):
        counts[s[right]] = counts.get(s[right], 0) + 1
        while invalid_condition(counts):
            counts[s[left]] -= 1
            left += 1
        max_len = max(max_len, right - left + 1)
    return max_len`,
        },
      ],
      personalNotes: `Watch for edge cases when string length is 0 or 1.`,
      tags: ['Two Pointers', 'Sliding Window', 'Array', 'String'],
    });

    const dp = await Topic.create({
      userId,
      subjectId: dsa._id,
      name: 'Dynamic Programming: 1D Subproblems',
      slug: 'dynamic-programming-1d-subproblems',
      lifecycleStatus: 'NOT_STARTED',
      masteryScore: 0,
      stabilityDays: 2.0,
      totalStudyMinutes: 0,
    });

    await ConceptLab.create({
      userId,
      topicId: dp._id,
      intuition: `### Optimal Substructure & Overlapping Subproblems\n\nDeconstruct the global problem into smaller sequential choices with memoized state transitions.`,
      complexity: {
        time: 'O(N)',
        space: 'O(1) with rolling variables',
        explanation: 'Evaluating N states where each transition takes O(1) time.',
      },
      codeSnippets: [],
      personalNotes: `Identify base cases first before formulating the recurrence relation.`,
      tags: ['Dynamic Programming', 'Memoization'],
    });

    res.json({
      success: true,
      message: 'Demo subjects and topics successfully seeded.',
      data: {
        subjects: [dsa, sysDesign, webDev],
        topics: [binarySearch, slidingWindow, dp],
      },
    });
  } catch (err) {
    next(err);
  }
});
