# SPREADSHEET: Copy of IPAS-P01714-Coming Lights-03-30-2026
Sheet: IPAS
Sheet ID: 1787812242
URL: https://docs.google.com/spreadsheets/d/1a60W5-ml3wjHMVig61O1Z2LuTcvvcteP_h-wKEChgy0/edit

## MERGED CELLS
- C10:F10
- A13:O13
- A17:B17
- C17:F17
- G17:O17
- C20:F20
- G20:O20
- A20:B20
- A23:B23
- C23:F23
- G23:O23
- A26:B26
- C26:F26
- G26:O26
- A29:B29
- C29:F29
- G29:O29
- A32:B32
- C32:F32
- G32:O32
- M33:O33
- C34:D34
- F34:H34
- J34:K34
- M34:O34
- F35:H35
- J35:K35
- M35:O35
- C38:D38
- C39:D39
- C42:D42
- C43:D43
- C35:D35
- C36:D36
- F36:H36
- J36:K36
- C37:D37
- J37:K37
- J38:K38
- J39:K39
- F42:H42
- F43:H43
- J43:K43
- F37:H37
- F38:H38
- F39:H39
- F40:H40
- F41:H41
- J41:K41
- L41:O41
- A1:O1
- A2:O2
- A4:B4
- C4:F4
- I4:J4
- L4:M4
- N4:O4
- L5:M5
- L6:M6
- L7:M7
- N7:O7
- L8:M8
- N8:O8
- A5:B5
- C5:F5
- I5:J5
- N5:O5
- C6:F6
- I6:J6
- N6:O6
- A6:B6
- A7:B7
- C7:F7
- I7:J7
- A8:B8
- C8:F8
- I8:J8
- L9:M9
- L10:M10
- L11:M11
- N11:O11
- L12:M12
- N12:O12
- A9:B9
- C9:F9
- I9:J9
- N9:O9
- A10:B10
- I10:J10
- N10:O10
- M36:O36
- M37:O37
- M38:O38

## DATA AND FORMULAS

### Row 1
- **A1** = "T3CK GROUP  - ILPAS FORM"

### Row 2
- **A2** = "IMPORTATION - LOCAL PURCHASE AND SHIPPING INFORMATION FORM"

### Row 4
- **A4** = "ITEM / DESCRIPTION:"
- **C4** = "Coming Lights"
- **I4** = "DATE CREATED"
- **K4** = "March 6, 2026"
- **L4** = "SHIPPERS NAME"
- **N4** = "SUPPLIER" | Validation: VALUE_IN_RANGE (Range; true)

### Row 5
- **A5** = "SUPPLIER:"
- **C5** = "Shenzhen Coming Technology Co., Ltd."
- **I5** = "P.O. NO."
- **K5** = "0"
- **L5** = "SHIPPING METHOD"
- **N5** = "BILL OF LAIDING" | Validation: VALUE_IN_LIST (N/A, BILL OF LAIDING, AIRWAY BILL, CONTAINER NO; true)

### Row 6
- **A6** = "PURCHASED BY:"
- **C6** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **I6** = "CURRENCY"
- **K6** = "$ USD" | Validation: VALUE_IN_LIST ($ USD, € EURO, ₱ PHP; true)
- **L6** = "NO."

### Row 7
- **A7** = "PRIORITY:"
- **C7** = "URGENT" | Validation: VALUE_IN_LIST (REGULAR, URGENT, CANCELLED; true)
- **I7** = "ITEM COST"
- **K7** = "15,769.00"
- **L7** = "PROCESSED BY"
- **N7** = "AVV - CUSTOM" | Validation: VALUE_IN_RANGE (Range; true)

### Row 8
- **A8** = "CLIENT NAME:"
- **I8** = "PREPAID FREIGHT COST"
- **K8** = "0.00"
- **L8** = "SHIPPING STATUS"
- **N8** = "DATE OF STATUS"

### Row 9
- **A9** = "CLIENT ADDRESS:"
- **I9** = "TO PAY"
- **K9** = "15,769.00" | Formula: `=K7+K8`
- **L9** = "ORDERED" | Validation: VALUE_IN_RANGE (Range; true)
- **N9** = "February 26, 2026"

### Row 10
- **A10** = "MOBILE NO:"
- **I10** = "BALANCE"
- **K10** = "0.00" | Formula: `=K9-G16-G19-G22-G25-G28-G31-I16-I19-I22-I25-I28-I31`
- **L10** = "BOARDED" | Validation: VALUE_IN_RANGE (Range; true)

### Row 11
- **L11** = "ARRIVED" | Validation: VALUE_IN_RANGE (Range; true)

### Row 12
- **L12** = "DELIVERED" | Validation: VALUE_IN_RANGE (Range; true)

### Row 13
- **A13** = "PAYMENT DETAILS"

### Row 14
- **J14** | Validation: VALUE_IN_LIST (USD, EURO, RMB; true)
- **K14** | Validation: VALUE_IN_LIST (USD, EURO, RMB; true)

### Row 15
- **A15** = "PAYMENT TERMS"
- **C15** = "PAYMENT DATE"
- **D15** = "PURCHASED BY"
- **F15** = "PAYMENT METHOD"
- **G15** = "$ USD" | Validation: VALUE_IN_LIST ($ USD, € EURO, ₱ PHP; true)
- **H15** = "PERCENTAGE"
- **I15** = "$ USD" | Formula: `=G15`
- **J15** = "FOREX RATE"
- **K15** = "PHP "
- **L15** = "BANK CHARGE"
- **M15** = "DOC STAMP"
- **N15** = "MISC FEE"
- **O15** = "TOTAL"

### Row 16
- **A16** = "1ST PAYMENT" | Validation: VALUE_IN_RANGE (Range; true)
- **C16** = "March 5, 2026"
- **D16** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **F16** = "PETNET" | Validation: VALUE_IN_RANGE (Range; true)
- **G16** = "11,038.30"
- **H16** = "0.00%" | Validation: VALUE_IN_RANGE (Range; true)
- **I16** = "0.00" | Formula: `=K9*H16`
- **J16** = "58.73"
- **K16** = "0.00" | Formula: `=I16*J16`
- **L16** = "400.00"
- **M16** = "0.00"
- **N16** = "0.00"
- **O16** = "PHP 648,679.36" | Formula: `=G16*J16+K16+L16+M16+N16+P16`

### Row 17
- **A17** = "REMARK:→"

### Row 18
- **A18** = "PAYMENT TERMS"
- **C18** = "PAYMENT DATE"
- **D18** = "PURCHASED BY"
- **F18** = "PAYMENT METHOD"
- **G18** = "$ USD" | Validation: VALUE_IN_LIST ($ USD, € EURO, ₱ PHP; true)
- **H18** = "PERCENTAGE"
- **I18** = "$ USD" | Formula: `=G18`
- **J18** = "FOREX RATE"
- **K18** = "PHP "
- **L18** = "BANK CHARGE"
- **M18** = "DOC STAMP"
- **N18** = "MISC FEE"
- **O18** = "TOTAL"

### Row 19
- **A19** = "2ND PAYMENT" | Validation: VALUE_IN_RANGE (Range; true)
- **C19** = "March 27, 2026"
- **D19** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **F19** = "PETNET" | Validation: VALUE_IN_RANGE (Range; true)
- **G19** = "4,730.70"
- **H19** = "0.00%" | Validation: VALUE_IN_RANGE (Range; true)
- **I19** = "0.00" | Formula: `=K9*H19`
- **J19** = "60.70"
- **K19** = "0.00" | Formula: `=I19*J19`
- **L19** = "400.00"
- **M19** = "0.00"
- **N19** = "0.00"
- **O19** = "PHP 287,553.49" | Formula: `=G19*J19+K19+L19+M19+N19+P19`

### Row 20
- **A20** = "REMARK:→"

### Row 21
- **A21** = "PAYMENT TERMS"
- **C21** = "PAYMENT DATE"
- **D21** = "PURCHASED BY"
- **F21** = "PAYMENT METHOD"
- **G21** = "$ USD" | Validation: VALUE_IN_LIST ($ USD, € EURO, ₱ PHP; true)
- **H21** = "PERCENTAGE"
- **I21** = "$ USD" | Formula: `=G21`
- **J21** = "FOREX RATE"
- **K21** = "PHP "
- **L21** = "BANK CHARGE"
- **M21** = "DOC STAMP"
- **N21** = "MISC FEE"
- **O21** = "TOTAL"

### Row 22
- **A22** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **D22** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **F22** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **G22** = "0.00"
- **H22** = "0.00%" | Validation: VALUE_IN_RANGE (Range; true)
- **I22** = "0.00" | Formula: `=K9*H22`
- **J22** = "0.00"
- **K22** = "0.00" | Formula: `=I22*J22`
- **L22** = "0.00"
- **M22** = "0.00"
- **N22** = "0.00"
- **O22** = "PHP 0.00" | Formula: `=G22*J22+K22+L22+M22+N22+P22`

### Row 23
- **A23** = "REMARK:→"

### Row 24
- **A24** = "PAYMENT TERMS"
- **C24** = "PAYMENT DATE"
- **D24** = "PURCHASED BY"
- **F24** = "PAYMENT METHOD"
- **G24** = "$ USD" | Validation: VALUE_IN_LIST ($ USD, € EURO, ₱ PHP; true)
- **H24** = "PERCENTAGE"
- **I24** = "$ USD" | Formula: `=G24`
- **J24** = "FOREX RATE"
- **K24** = "PHP "
- **L24** = "BANK CHARGE"
- **M24** = "DOC STAMP"
- **N24** = "MISC FEE"
- **O24** = "TOTAL"

### Row 25
- **A25** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **D25** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **F25** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **H25** = "0.00%" | Validation: VALUE_IN_RANGE (Range; true)
- **I25** = "0.00" | Formula: `=K9*H25`
- **J25** = "0.00"
- **K25** = "0.00" | Formula: `=I25*J25`
- **L25** = "0.00"
- **M25** = "0.00"
- **N25** = "0.00"
- **O25** = "PHP 0.00" | Formula: `=G25*J25+K25+L25+M25+N25+P25`

### Row 26
- **A26** = "REMARK:→"

### Row 27
- **A27** = "PAYMENT TERMS"
- **C27** = "PAYMENT DATE"
- **D27** = "PURCHASED BY"
- **F27** = "PAYMENT METHOD"
- **G27** = "$ USD" | Validation: VALUE_IN_LIST ($ USD, € EURO, ₱ PHP; true)
- **H27** = "PERCENTAGE"
- **I27** = "$ USD" | Formula: `=G27`
- **J27** = "FOREX RATE"
- **K27** = "PHP "
- **L27** = "BANK CHARGE"
- **M27** = "DOC STAMP"
- **N27** = "MISC FEE"
- **O27** = "TOTAL"

### Row 28
- **A28** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **D28** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **F28** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **G28** = "0.00"
- **H28** = "0.00%" | Validation: VALUE_IN_RANGE (Range; true)
- **I28** = "0.00" | Formula: `=K9*H28`
- **J28** = "0.00"
- **K28** = "0.00" | Formula: `=I28*J28`
- **L28** = "0.00"
- **M28** = "0.00"
- **N28** = "0.00"
- **O28** = "PHP 0.00" | Formula: `=G28*J28+K28+L28+M28+N28+P28`

### Row 29
- **A29** = "REMARK:→"

### Row 30
- **A30** = "PAYMENT TERMS"
- **C30** = "PAYMENT DATE"
- **D30** = "PURCHASED BY"
- **F30** = "PAYMENT METHOD"
- **G30** = "$ USD" | Validation: VALUE_IN_LIST ($ USD, € EURO, ₱ PHP; true)
- **H30** = "PERCENTAGE"
- **I30** = "$ USD" | Formula: `=G30`
- **J30** = "FOREX RATE"
- **K30** = "PHP "
- **L30** = "BANK CHARGE"
- **M30** = "DOC STAMP"
- **N30** = "MISC FEE"
- **O30** = "TOTAL"

### Row 31
- **A31** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **D31** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **F31** = "N/A" | Validation: VALUE_IN_RANGE (Range; true)
- **G31** = "0.00"
- **H31** = "0.00%" | Validation: VALUE_IN_RANGE (Range; true)
- **I31** = "0.00" | Formula: `=K9*H31`
- **J31** = "0.00"
- **K31** = "0.00" | Formula: `=I31*J31`
- **L31** = "0.00"
- **M31** = "0.00"
- **N31** = "0.00"
- **O31** = "PHP 0.00" | Formula: `=G31*J31+K31+L31+M31+N31+P31`

### Row 32
- **A32** = "REMARK:→"

### Row 33
- **A33** = "SHIPPING DETAILS"
- **M33** = "DATE OF PAYMENT"

### Row 34
- **C34** = "ORIGIN DOCS - SUPPLIERS"
- **F34** = "DESTINATION DOCS - PROCESSORS"
- **J34** = "SUB TOTAL"
- **L34** = "PHP 936,232.85" | Formula: `=O16+O19+O22+O25+O28+O31`

### Row 35
- **A35** | Validation: VALUE_IN_LIST (✓, X; true)
- **B35** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **C35** = "PROFORMA INVOICE"
- **E35** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **F35** = "STATEMENT OF ACCOUNT"
- **J35** = "ORIGIN CHARGE"
- **L35** = "PHP 0.00"

### Row 36
- **A36** | Validation: VALUE_IN_LIST (✓, X; true)
- **B36** = "X" | Validation: VALUE_IN_LIST (✓, X; true)
- **C36** = "SALES CONTRACT "
- **E36** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **F36** = "ACKNOWLEDGEMENT RECEIPT"
- **J36** = "DESTINATION CHARGE"
- **L36** = "PHP 0.00"

### Row 37
- **A37** | Validation: VALUE_IN_LIST (✓, X; true)
- **B37** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **C37** = "BL OR AIRWAYBILL"
- **E37** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **F37** = "FREIGHT BILLING"
- **J37** = "COLLECT FREIGHT COST "
- **L37** = "PHP 0.00"

### Row 38
- **A38** | Validation: VALUE_IN_LIST (✓, X; true)
- **B38** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **C38** = "PACKING LIST "
- **E38** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **F38** = "OFFICIAL RECEIPT "
- **J38** = "DUTIES & TAXES"
- **L38** = "PHP 0.00"

### Row 39
- **A39** | Validation: VALUE_IN_LIST (✓, X; true)
- **B39** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **C39** = "COMMERCIAL INVOICE"
- **E39** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **F39** = "BOC ASSESSEMENT"
- **J39** = "TOTAL COST"
- **L39** = "PHP 936,232.85" | Formula: `=SUM(L34:L38)`

### Row 40
- **A40** | Validation: VALUE_IN_LIST (✓, X; true)
- **B40** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **C40** = "FORM-E - FORM AK"
- **D40** | Validation: VALUE_IN_LIST (✓, X; true)
- **F40** = "T3CKGROUP DOCS"

### Row 41
- **A41** | Validation: VALUE_IN_LIST (✓, X; true)
- **B41** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **C41** = "PRODUCT BROCHURES"
- **D41** | Validation: VALUE_IN_LIST (✓, X; true)
- **E41** = "✓" | Validation: VALUE_IN_LIST (✓, X; true)
- **F41** = "T/T PROOF OF PAYMENT"
- **L41** = "SUMMARY DETAILS"

### Row 42
- **A42** | Validation: VALUE_IN_LIST (✓, X; true)
- **B42** = "X" | Validation: VALUE_IN_LIST (✓, X; true)
- **C42** = "MSDS DATA SHEET"
- **E42** = "X" | Validation: VALUE_IN_LIST (✓, X; true)
- **F42** = "PURCHASE ORDER"
- **L42** = "BANK CHARGE"
- **M42** = "PHP 800.00" | Formula: `=L16+L19+L22+L25+L28+L31`
- **N42** = "MISC"
- **O42** = "PHP 0.00" | Formula: `=N16+N19+N22+N25+N28+N31`

### Row 43
- **A43** | Validation: VALUE_IN_LIST (✓, X; true)
- **B43** = "X" | Validation: VALUE_IN_LIST (✓, X; true)
- **C43** = "OTHERS"
- **E43** = "X" | Validation: VALUE_IN_LIST (✓, X; true)
- **F43** = "OTHERS"
- **L43** = "DOCS STAMP"
- **M43** = "PHP 0.00" | Formula: `=M16+M19+M22+M25+M28+M31`