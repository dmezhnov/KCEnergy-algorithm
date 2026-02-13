# Algorithm Notes (DSL Summary)

## Overview

The algorithm distributes petroleum product (NP) volumes from refineries (NPZ)
to market participants based on their requests, subject to constraints
(available supply, deficit/surplus, moving averages, tonnage norms, share caps).

## File Structure

### Foundation Files

| File | Purpose |
|---|---|
| `lang.lang` | DSL syntax: property access, function call equivalences, list notation |
| `matrix_types.lang` | Axes (Region, Product, Refinery, etc.), index types (i,j,k,l,...), matrix definition |
| `matrix_operation.lang` | Matrix operations: sum_by_axes, for_each_element, filter_by_value, filter_by_pair, for_each_pair, count_coordinates_by_axis, filter_by_coordinate, assign_matrix, replace_coord |
| `initial_data.lang` | Input data: requests, volumes (spills), available volumes, constants (thresholds, tonnage norms, share limits) |

### Index Convention

| Index | Letter | Axis | Description |
|---|---|---|---|
| I (i) | i | Product | Petroleum product type |
| J (j) | j | Refinery | Refinery (NPZ) |
| K (k) | k | Region | Region |
| K0 (k0) | k0 | District | District |
| P (l) | l | Market_participant | Market participant |
| Y (t) | t | Month_and_year | Month/year period |
| R (l0) | l0 | Queue | Queue (priority: First, Second, Third, Fourth) |
| C (s) | s | Ship_terms | Shipping terms (FCA = from refinery, EXW = from oil terminal) |
| Z (q) | q | Request | Individual request |
| I0 (i0) | i0 | Product_category | Product category |

### Constants

| Name | Value | Description |
|---|---|---|
| OVERALL_REQUEST_CAPACITY_PERCENTAGE | 120% | Threshold to detect deficit |
| RAIL_ROAD_MIN_TONNAGE | 65 MT | Wagon norm for refinery shipments (FCA) |
| OIL_TERMINAL_MIN_TONNAGE | 4 MT | Minimum norm for oil terminal (EXW) |
| OIL_TERMINAL_STEP_TONNAGE | 5 MT | Step granularity for oil terminal |
| MAX_SUBJECT_SHARE_PERCENTAGE | 50% | Max share one participant can receive |

## Algorithm Steps

### Step -1: Aggregate requests by Request axis

**File:** `step-minus-1.lang`
**Input:** `requests_i_j_k_l_s_l0_q` (7D matrix with Request axis)
**Output:** `requests_i_j_k_l_s_l0` (6D matrix, Request axis summed away)
**Operation:** `sum_by_axes(requests, Request)` -- collapses individual requests into totals per participant.

### Step 0: Aggregate spill volumes

**File:** `step-0.lang`
**Input:** `volumes_l_t_i_k_k0_i0` (6D: Market_participant, Month_and_year, Product, Region, District, Product_category)
**Output:** `volumes_l_t_i_k` (4D: Market_participant, Product, Region, Month_and_year)
**Operations:**
1. Filter volumes to only relevant products (AI_92, Diesel, AI_95, AI_98)
2. Sum by Product_category axis -> `volumes_l_t_i_k_k0`
3. Sum by District axis -> `volumes_l_t_i_k`

Purpose: Prepare retail sales (spill) data for moving average calculation.

### Step 1: Aggregate requests by axes

**File:** `step-1.lang`
**Input:** `requests_i_j_k_l_s_l0` from step -1
**Output:** Various aggregation levels:
- `requests_i_j_k_l_s(l0)` -- filter by queue (l0), removing Queue axis
- `requests_i_j_k_l_s.First` -- filter specifically for First queue
- `requests_i_j_k_l_l0` -- sum by Ship_terms
- `requests_i_j_k_l` -- sum by Ship_terms + Queue
- `requests_i_j_k` -- sum by Market_participant
- `requests_i_j` -- sum by Region (final: Product x Refinery totals)

Purpose: Build total request volumes per (Product, Refinery) pair for deficit detection.

### Step 2: Deficit / Surplus classification

**File:** `step-2.lang`
**Input:** `requests_i_j`, `available_i_j.First`, `OVERALL_REQUEST_CAPACITY_COEFFICIENT`
**Output:**
- `threshold_i_j` = available * 1.2
- `requests_i_j_deficit` = requests where total >= threshold (deficit pairs)
- `requests_i_j_surplus` = requests where total < threshold (surplus pairs)

Purpose: Classify each (Product, Refinery) pair as deficit or surplus.

### Step 3.1.0: Moving average

**File:** `step-3.1.0.lang`
**Input:** `volumes_l_t_i_k` from step 0
**Output:** `moving_average` matrix (Market_participant, Product, Region)
**Operations:**
1. Filter volumes > 0 -> `volumes_l_t_i_k_positive`
2. Count active months per (l,i,k) -> `matrix_of_activity`
3. Sum volumes by Month_and_year -> `volumes_l_i_k`
4. Divide: `moving_average = volumes_l_i_k / matrix_of_activity` (safe_divide, 0 if no activity)

Purpose: Compute per-participant average monthly sales to cap deficit requests.

### Step 3.2.0: Split deficit requests by refinery count

**File:** `step-3.2.0.lang`
**Input:** `requests_i_j_deficit`, `requests_i_j_k_l_s.First`
**Output:**
- `requests_i_j_k_l_s_deficit` -- deficit requests for first queue
- `refinery_count_by_deficit_requests` -- count of deficit refineries per participant
- `requests_i_j_k_l_s_deficit_single` -- requests to exactly 1 deficit refinery
- `requests_i_j_k_l_s_deficit_multiple` -- requests to >1 deficit refineries

Purpose: Separate deficit requests into single-refinery and multi-refinery cases
for different correction logic.

### Step 3.2.1: Correct single-refinery deficit requests

**File:** `step-3.2.1.lang`
**Input:** `requests_i_j_k_l_s_deficit_single`, `moving_average`
**Output:**
- `requests_i_j_k_l_s_deficit_single_corrected` = min(request, moving_average)
- `requests_i_j_k_l_s_deficit_single_pend` = max(request - corrected, 0) (excess)

Purpose: Cap single-refinery deficit requests at moving average. Track "pending" excess.

### Step 3.2.2: Correct multi-refinery deficit requests

**File:** `step-3.2.2.lang`
**Input:** `requests_i_j_k_l_s_deficit_multiple`, `moving_average`
**Output:**
- `requests_i_j_k_l_s_deficit_multiple_corrected` (corrected proportionally)
- `requests_i_j_k_l_s_deficit_multiple_pend` (pending excess)
**Operations:**
1. Sum multiple requests by Refinery -> total per participant
2. Compute share of each refinery in total
3. Multiply share * moving_average -> proportional cap per refinery
4. Corrected = min(request, proportional_cap)
5. Pend = request - proportional_cap

Purpose: For multi-refinery requests, distribute the moving average cap proportionally.

### Step 3.3.0: Redistribute pending volume to surplus refineries

**File:** `step-3.3.0.lang`
**Input:** Corrected + pending matrices from 3.2.1 and 3.2.2, surplus classification
**Output:** `requests_i_j_k_l_s_corrected.First` (fully corrected first-queue requests)
**Operations:**
1. Merge single + multiple corrected -> `requests_i_j_k_l_s_deficit_corrected`
2. Extract surplus requests from first queue
3. Merge single + multiple pending -> `requests_i_j_k_l_s_deficit_pend`
4. Replace deficit refinery coordinates with surplus ones (`replace_coord`)
5. Add redistributed pending to surplus requests
6. Final merge: deficit_corrected + surplus_corrected = `requests_i_j_k_l_s_corrected.First`

Purpose: Move excess volume from deficit refineries to surplus ones.

### Step 4: Total corrected volumes

**File:** `step-4.lang`
**Input:** `requests_i_j_k_l_s_corrected.First`, queued requests
**Output:**
- `requests_i_j_corrected(l0)` -- total corrected per (Product, Refinery) per queue
- `requests_i_j_s_corrected(l0)` -- with Ship_terms retained
**Operations:**
- For non-first queues: corrected = original (no deficit correction)
- Sum by Region, Market_participant to get totals
- Sum by Ship_terms to get (Product, Refinery) totals

Purpose: Aggregate corrected requests for subsequent distribution.

### Step 5: Preliminary distribution

**File:** `step-5.lang`
**Input:** `requests_i_j_corrected`, `available_i_j`, `requests_i_j_k_l_s_corrected`
**Output:** `estimated_i_j_k_l_s(l0)(1)` -- first iteration estimated volumes
**Operations:**
1. Compare corrected total vs available: exceed or not_exceed?
2. **Exceed case:** share = available / corrected_total; estimated = corrected * share
3. **Not exceed case:** estimated = corrected (fulfill fully)
4. Merge into first estimated matrix (`n=1`)

Purpose: Proportionally distribute available volume when demand exceeds supply.

### Step 6: Normalization (rounding to tonnage norms)

**File:** `step-6.lang`
**Input:** `estimated_i_j_k_l_s(l0)(n)`
**Output:** `normalized_i_j_k_l_s(l0)(n)` -- normalized volumes
**Operations:**
1. Split by Ship_terms: FCA (refinery) vs EXW (oil terminal)
2. **FCA normalization:**
   - coeff = estimated / RAIL_ROAD_MIN_TONNAGE (65)
   - Round (n=1) or floor (n>1) to integer
   - Multiply back by 65
   - Enforce minimum: max(result, 65) for n=1, max(result, 0) for n>1
3. **EXW normalization:**
   - coeff = estimated / OIL_TERMINAL_STEP_TONNAGE (5)
   - Round/floor to integer, multiply back by 5
   - If estimated < OIL_TERMINAL_MIN_TONNAGE(4): set to 4 (n=1) or 0 (n>1)
   - Else: max(rounded, 4) for n=1, max(rounded, 0) for n>1
4. Reassemble FCA + EXW into normalized matrix

Purpose: Round volumes to transport-feasible quantities.

### Step 7.1: Aggregate normalized volumes

**File:** `step-7.1.lang`
**Input:** `normalized_i_j_k_l_s(l0)(n)`
**Output:**
- `normalized_i_l_s(l0)(n)` -- per participant (sum by Refinery, Region)
- `normalized_i_l(l0)(n)` -- per participant (sum by Ship_terms too)
- `normalized_i(l0)(n)` -- total per product (sum by Market_participant)

Purpose: Compute totals for share limit checking.

### Step 7.2: Share limit enforcement (iterative loop)

**File:** `step-7.2.lang`
**Input:** `normalized_i_j_k_l_s`, `normalized_i_l`, `normalized_i`, `MAX_SUBJECT_SHARE_COEFFICIENT`
**Output:** `estimated_i_j_k_l_s(l0)(n+1)` -- next iteration's estimated volumes
**Operations:**
1. Threshold = total * MAX_SUBJECT_SHARE_COEFFICIENT (50%)
2. Find participants exceeding threshold
3. For exceeding participants: scale down by (threshold / their_total)
4. Create new estimated matrix -> goes back to Step 6 for re-normalization
5. **Loop terminates** when no participants exceed the share limit (corrected matrix is empty)

Purpose: Iteratively cap any participant's share at 50%, re-normalize, repeat.

### Step 8: Remaining volume after distribution

**File:** `step-8.lang`
**Input:** Last estimated matrix, `available_i_j`
**Output:**
- `available_i_j_new(l0)` = available - distributed (remaining per refinery)

Purpose: Calculate leftover volume after first queue is served, for next queue.

### Step 9: Check availability for next queue

**File:** `step-9.lang`
**Input:** `available_i_j_new`, tonnage norms
**Output:**
- `available_i_j(l0+1)` -- available for next queue (filtered by minimum tonnage)
- `available_i_j_final` -- final remaining after all queues
- `estimated_i_j_k_l_final` -- merged results across all queues

Purpose: Filter out refineries with insufficient remaining volume, pass rest to next queue.

### Step N+1: Distribute results back to individual requests

**File:** `step-n-plus-1.lang`
**Input:** `estimated_i_j_k_l_final`, `requests_i_j_k_l_s_l0_q` (original with Request axis)
**Output:** `requests_i_j_k_l_s_l0_q_final_not_exceed_all` -- final per-request allocations
**Operations:**
1. Merge estimated with original request structure
2. If allocated > requested: cap at requested, carry excess to next request
3. If allocated <= requested: accept as-is
4. Iterate until all excess is redistributed
5. Merge all non-exceeding results

Purpose: Map aggregated allocations back to individual requests, ensuring no request
gets more than it asked for.

## Processing Pipeline Summary

```
Input Data
  |
  v
Step -1: Sum by Request axis
  |
  v
Step 0: Aggregate spill volumes (for moving average)
  |
  v
Step 1: Aggregate requests -> totals per (Product, Refinery)
  |
  v
Step 2: Classify (Product, Refinery) as deficit or surplus
  |
  v
Step 3.1.0: Compute moving average from spill history
  |
  v
Step 3.2.0: Split deficit requests by refinery count (single vs multiple)
  |
  +---> Step 3.2.1: Correct single-refinery deficit (cap at moving avg)
  |
  +---> Step 3.2.2: Correct multi-refinery deficit (proportional cap)
  |
  v
Step 3.3.0: Redistribute pending to surplus refineries, merge all corrections
  |
  v
Step 4: Compute total corrected volumes per queue
  |
  v
  +==========================================+
  | ITERATIVE LOOP (n = 1, 2, ...)           |
  |                                          |
  | Step 5: Preliminary distribution         |
  |   (proportional if exceeds available)    |
  |         |                                |
  |         v                                |
  | Step 6: Normalize (round to tonnage)     |
  |         |                                |
  |         v                                |
  | Step 7.1: Aggregate normalized volumes   |
  |         |                                |
  |         v                                |
  | Step 7.2: Check share limits (50%)       |
  |   If exceeded -> create n+1 estimates    |
  |   and loop back to Step 6               |
  |   If not exceeded -> exit loop           |
  +==========================================+
  |
  v
Step 8: Compute remaining volume per refinery
  |
  v
Step 9: Pass remaining to next queue (if sufficient)
  |
  v (repeat Steps 1-9 for each queue: First -> Second -> Third -> Fourth)
  |
  v
Step N+1: Map allocations back to individual requests
```

## Key Concepts

- **Queue priority:** First (gas station owners), Second (oil terminal owners),
  Third, Fourth -- each queue gets the leftovers from the previous one
- **Deficit vs Surplus:** Determined per (Product, Refinery) by comparing total
  requests against 120% of available volume
- **Moving average cap:** In deficit, requests are capped at the participant's
  12-month moving average of actual sales
- **Normalization:** FCA rounds to multiples of 65 MT (wagon), EXW rounds to
  multiples of 5 MT (oil terminal step) with minimum 4 MT
- **Share limit:** No single participant can receive more than 50% of the total
  for a product type; enforced iteratively
- **Pending redistribution:** Excess volume cut from deficit refineries is
  redirected to surplus refineries where possible
