import React, { Component } from "react";
import PropTypes from "prop-types";
import { Session } from "meteor/session";
import { Meteor } from "meteor/meteor";
import { composeWithTracker, Components } from "@reactioncommerce/reaction-components";
import { Catalog, ReactionProduct } from "/lib/api";
import { Reaction, i18next } from "/client/api";
import { getChildVariants } from "../selectors/variants";
import { Products } from "/lib/collections";
import update from "immutability-helper";
import { getVariantIds } from "/lib/selectors/variants";
import { Media } from "/imports/plugins/core/files/client";

/**
 *
 * @param {*} variantId
 */
function variantIsSelected(variantId) {
  const current = ReactionProduct.selectedVariant();
  if (
    current &&
    typeof current === "object" &&
    (variantId === current._id || current.ancestors.indexOf(variantId) >= 0)
  ) {
    return true;
  }

  return false;
}

/**
 *
 * @param {*} variantId
 */
function variantIsInActionView(variantId) {
  const actionViewVariant = Reaction.getActionView().data;

  if (actionViewVariant) {
    // Check if the variant is selected, and also visible & selected in the action view
    return variantIsSelected(variantId) && variantIsSelected(actionViewVariant._id) && Reaction.isActionViewOpen();
  }

  return false;
}

/**
 *
 */
function getTopVariants() {
  let inventoryTotal = 0;
  const variants = ReactionProduct.getTopVariants();
  if (variants.length) {
    // calculate inventory total for all variants
    for (const variant of variants) {
      if (variant.inventoryManagement) {
        const qty = variant.inventoryAvailableToSell;
        if (typeof qty === "number") {
          inventoryTotal += qty;
        }
      }
    }
    // calculate percentage of total inventory of this product
    for (const variant of variants) {
      const qty = variant.inventoryAvailableToSell;
      variant.inventoryTotal = inventoryTotal;
      if (variant.inventoryManagement && inventoryTotal) {
        variant.inventoryPercentage = parseInt(qty / inventoryTotal * 100, 10);
      } else {
        // for cases when sellers doesn't use inventory we should always show
        // "green" progress bar
        variant.inventoryPercentage = 100;
      }
      if (variant.title) {
        variant.inventoryWidth = parseInt(variant.inventoryPercentage - variant.title.length, 10);
      } else {
        variant.inventoryWidth = 0;
      }
    }
    // sort variants in correct order
    variants.sort((variantA, variantB) => variantA.index - variantB.index);

    return variants;
  }
  return [];
}

/**
 *
 * @param {*} variant
 */
function isSoldOut(variant) {
  return variant.inventoryAvailableToSell < 1;
}

/**
 *
 */
class VariantListContainer extends Component {
  state = {
    selectedVariant: null
  }

  get variants() {
    return (this.state && this.state.variants) || this.props.variants;
  }

  get productHandle() {
    const selectedProduct = ReactionProduct.selectedProduct();
    return (selectedProduct.__published && selectedProduct.__published.handle) || selectedProduct.handle;
  }

  handleCreateVariant = () => {
    const selectedProduct = ReactionProduct.selectedProduct();

    Meteor.call("products/createVariant", selectedProduct._id, (error) => {
      if (error) {
        Alerts.alert({
          text: i18next.t("productDetailEdit.addVariantFail", { title: selectedProduct.title }),
          confirmButtonText: i18next.t("app.close", { defaultValue: "Close" })
        });
      }
    });
  };

  handleVariantClick = (event, variant, ancestors = -1) => {
    this.handleEditVariant(event, variant, ancestors);
  };

  handleEditVariant = (event, variant, ancestors = -1) => {
    let editVariant = variant;
    if (ancestors >= 0) {
      editVariant = Products.findOne(variant.ancestors[ancestors]);
    }

    const cardName = `variant-${variant._id}`;
    Reaction.state.set("edit/focus", cardName);

    ReactionProduct.setCurrentVariant(variant._id);
    Session.set(`variant-form-${editVariant._id}`, true);

    if (Reaction.hasPermission("createProduct")) {
      this.setState({ selectedVariant: variant });
    }

    // Prevent the default edit button `onEditButtonClick` function from running
    return false;
  };

  handleVariantVisibilityToggle = (event, variant, variantIsVisible) => {
    Meteor.call("products/updateProductField", variant._id, "isVisible", variantIsVisible);
  };

  handleMoveVariant = (dragIndex, hoverIndex) => {
    const variant = this.props.variants[dragIndex];

    // Apply new sort order to variant list
    const newVariantOrder = update(this.props.variants, {
      $splice: [[dragIndex, 1], [hoverIndex, 0, variant]]
    });

    // Set local state so the component doesn't have to wait for a round-trip
    // to the server to get the updated list of variants
    this.setState({
      variants: newVariantOrder
    });

    // Save the updated positions
    Meteor.defer(() => {
      Meteor.call("products/updateVariantsPosition", getVariantIds(newVariantOrder), variant.shopId);
    });
  };

  render() {
    return (
      <Components.VariantList
        onEditVariant={this.handleEditVariant}
        onMoveVariant={this.handleMoveVariant}
        onVariantClick={this.handleVariantClick}
        onVariantVisibiltyToggle={this.handleVariantVisibilityToggle}
        onCreateVariant={this.handleCreateVariant}
        selectedVariant={this.state.selectedVariant}
        onVariantEditComplete={() => this.setState({ selectedVariant: null })}
        {...this.props}
        variants={this.variants}
      />
    );
  }
}

/**
 * @private
 * @param {Object} props Props
 * @param {Function} onData Call this to update props
 * @returns {undefined}
 */
function composer(props, onData) {
  let childVariantMedia = [];
  const childVariants = getChildVariants();

  if (Array.isArray(childVariants)) {
    childVariantMedia = Media.findLocal(
      {
        "metadata.variantId": {
          $in: getVariantIds(childVariants)
        }
      },
      {
        sort: {
          "metadata.priority": 1
        }
      }
    );
  }

  const editable = Reaction.hasPermission(["createProduct"]);

  onData(null, {
    variants: getTopVariants(),
    variantIsSelected,
    variantIsInActionView,
    childVariants,
    childVariantMedia,
    displayPrice: (variantId) => Catalog.getVariantPriceRange(variantId),
    isSoldOut,
    editable
  });
}

VariantListContainer.propTypes = {
  variants: PropTypes.arrayOf(PropTypes.object)
};

export default composeWithTracker(composer)(VariantListContainer);
