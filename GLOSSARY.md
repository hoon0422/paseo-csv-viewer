# CSV Viewer

A read-only Paseo panel for inspecting one CSV or TSV file at a time, however large.

## Language

**Source**:
The CSV or TSV file the viewer is showing, read in place and never modified.
_Avoid_: Document, dataset

**File name**:
The source's base name, shown for reading only.

**Path**:
Where the source lives: relative to the workspace when it is inside it, absolute otherwise. The user can edit it to open another source.
_Avoid_: Location, URL

**Filter**:
One or more filter rules, matched all together or any one of them, that narrow the visible rows. Rows that do not match are hidden, not highlighted.
_Avoid_: Find, Search, Query

**Filter rule**:
A column (or any visible column), an operator and a value, such as `city contains toronto`. A rule can be switched off without being removed; only rules switched on take part in the filter.
_Avoid_: Condition, clause

**Preview**:
The first rows of a source, shown while the rest is still being prepared.

**Preparation**:
Reading the whole source once so that every row can be sorted and filtered. Sorting and filtering wait until it finishes.

**Selection**:
The set of rows the user has picked for copying. It is cleared when the sort, the filter or the source changes.

**Sort**:
An ordering of all rows by one column, ascending or descending. At most one column is sorted at a time.

**Sort mode**:
How a sort compares cells: Auto, Numeric or Text. Numeric compares cells as approximate numbers, precise to about 15 significant digits. Auto picks Numeric when every non-blank cell in the column is a number.

**Hidden column**:
A column the user has removed from view. It is left out of copies and of "any column" filter rules, but a rule can still name it directly.

**Expanded row**:
A row the user has opened to show its full cell contents. It collapses when the sort, filter or source changes.
