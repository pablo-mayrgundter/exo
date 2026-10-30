// Conway's Game of Life on a 16×16 torus, in 6502 assembly. This is what
// the chip under the street is running. The board is one byte per cell
// (0 or 1); two pages ping-pong as source and destination, so a generation
// is written cell by cell into the other page, and the bar's wall shows
// those writes as they happen.
//
// Index i = y·16 + x fits a byte, so up and down are i∓16 with 8-bit wrap
// for free, and left and right keep the row (i & $F0) and wrap the column.

export const BOARD = { a: 0x0200, b: 0x0300, size: 16 }
export const ZP = { src: 0x10, dst: 0x12, i: 0x14, l: 0x15, r: 0x16, row: 0x17, sum: 0x18, t: 0x19, gen: 0x1a }

export const source = `
SRC = $10      ; pointer to the current board
DST = $12      ; pointer to the board being written
I   = $14      ; the cell being computed
L   = $15      ; its left neighbour's column
R   = $16      ; its right neighbour's column
ROW = $17
SUM = $18
T   = $19
GEN = $1a      ; generation counter
BOARD_A = $0200
BOARD_B = $0300

        .org $0400
start:  ldx #$ff
        txs
        lda #<BOARD_A
        sta SRC
        sta DST
        lda #>BOARD_A
        sta SRC+1
        lda #>BOARD_B
        sta DST+1
        lda #0
        sta GEN
        tay
clear:  sta BOARD_A,y           ; the boards start empty
        sta BOARD_B,y
        iny
        bne clear
        ldx #0                  ; seed: a glider and an R-pentomino
seed:   ldy seeds,x
        cpy #$ff
        beq gen
        lda #1
        sta BOARD_A,y
        inx
        jmp seed

gen:    lda #0
        sta I
cell:   lda I
        and #$f0
        sta ROW
        lda I                   ; left column, same row
        sec
        sbc #1
        and #$0f
        ora ROW
        sta L
        lda I                   ; right column, same row
        clc
        adc #1
        and #$0f
        ora ROW
        sta R
        lda #0
        sta SUM
        lda L
        jsr col3
        lda R
        jsr col3
        lda I
        jsr col2
        ldy I                   ; 3 → born, 2 → stays, else dies
        lda SUM
        cmp #3
        beq alive
        cmp #2
        bne dead
        lda (SRC),y
        jmp store
alive:  lda #1
        jmp store
dead:   lda #0
store:  sta (DST),y
        inc I
        bne cell

        lda SRC+1               ; swap the boards
        ldx DST+1
        sta DST+1
        stx SRC+1
        inc GEN
        lda GEN                 ; every 32 generations a new glider drops in
        and #$1f
        bne gen
        lda GEN
        asl a
        asl a
        clc
        adc GEN
        and #$f7
        sta T
        ldx #0
drop:   lda glider,x
        cmp #$ff
        beq gen
        clc
        adc T
        tay
        lda #1
        sta (SRC),y
        inx
        jmp drop

; adds the cells above, at and below column A to SUM
col3:   tay
        lda (SRC),y
        clc
        adc SUM
        sta SUM
        tya
; adds the cells above and below column A to SUM
col2:   sta T
        sec
        sbc #16
        tay
        lda (SRC),y
        clc
        adc SUM
        sta SUM
        lda T
        clc
        adc #16
        tay
        lda (SRC),y
        clc
        adc SUM
        sta SUM
        rts

seeds:  .byte $01, $12, $20, $21, $22               ; glider at the top left
        .byte $88, $89, $97, $98, $a8               ; R-pentomino in the middle
        .byte $ff
glider: .byte $01, $12, $20, $21, $22, $ff

        .org $fffc
        .word start, start
`
