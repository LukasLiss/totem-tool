all:
	latexmk -pdf -interaction=nonstopmode main.tex

clean:
	latexmk -C
	rm -f main.bbl

figures:
	python ../totem_lib/evaluation/vldb/plots.py figures

.PHONY: all clean figures
