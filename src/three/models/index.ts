import type { ModelInput, ProductModel } from './common';
import { buildCan } from './can';
import { buildBottle } from './bottle';
import { buildPerfume } from './perfume';
import { buildCarton } from './carton';
import { buildPillow, buildTube, buildPouch, buildJar } from './packaging';
import { buildTote, buildGarment, buildCap } from './textile';
import { buildCup, buildMug } from './drinkware';
import { buildCard, buildLetterhead } from './stationery';

export type { ModelInput, ProductModel, PoseParams } from './common';

export function buildModel(input: ModelInput): ProductModel {
  switch (input.template) {
    case 'can': return buildCan(input);
    case 'bottle': return buildBottle(input);
    case 'perfume': return buildPerfume(input);
    case 'tuck-reverse': case 'tuck-straight': case 'mailer': case 'sleeve': case 'paper-bag': return buildCarton(input);
    case 'pillow': return buildPillow(input);
    case 'tube': return buildTube(input);
    case 'pouch': return buildPouch(input);
    case 'jar': return buildJar(input);
    case 'tote': return buildTote(input);
    case 'tee': return buildGarment(input, 'tee');
    case 'hoodie': return buildGarment(input, 'hoodie');
    case 'cap': return buildCap(input);
    case 'cup': return buildCup(input);
    case 'mug': return buildMug(input);
    case 'card': return buildCard(input);
    case 'letterhead': return buildLetterhead(input);
    default: return buildCan(input);
  }
}
